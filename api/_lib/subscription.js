/**
 * Subscription state machine — Phase 03 D2.
 *
 * `resolveSubscriptionState` is a PURE function of (subscription, now). It is
 * called by three callers that must never disagree:
 *
 *   1. the hourly cron sweep
 *   2. the Paystack webhook handler
 *   3. the lazy on-read check in every authenticated request
 *
 * Purity is the whole design. If any of those three computed status
 * differently, a teacher could be locked out by one path and admitted by
 * another, and the resulting bug would be unreproducible. No clock reads, no
 * I/O, no randomness — `now` is always injected.
 *
 * States:
 *   trialing   14 days (config/billing), no card. Full tier access.
 *   active     normal.
 *   past_due   LEGACY (before 013Fixes / 18): the period ended unpaid.
 *   grace      LEGACY: 48 hours after past_due, full access. A school already
 *              here at the release keeps its graceEndsAt.
 *   locked     billing page only. Students see "temporarily unavailable".
 *   cancelled  cancelAtPeriodEnd, full access until currentPeriodEnd.
 *   expired    cancelled and elapsed. 90-day retention clock starts.
 *
 * 013Fixes / 18 (owner answers round 3): the countdown runs INSIDE the
 * period, and the school locks at its end — no grace after it. A trial, an
 * M-Pesa or a manual period counts down in its last `countdownHours`; a card
 * subscription is expected to renew (no countdown) and gets a technical
 * `cardRenewalToleranceHours` for Paystack's renewal webhook before locking;
 * a failed card payment (`paymentFailedAt`) starts the countdown at once.
 * The window (`billingWindow`) is what the screens show.
 */

/** 013Fixes / 18: the defaults behind config/billing (api/_lib/billingSettings.js). */
export const BILLING_DEFAULTS = Object.freeze({ trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6 });

export const STATUS = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  GRACE: 'grace',
  LOCKED: 'locked',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

export const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;
export const TRIAL_DAYS = 14;
export const RETENTION_DAYS = 90;

/** Statuses in which the teacher retains full access to their tier. */
const ACCESS_GRANTED = new Set([
  STATUS.TRIALING,
  STATUS.ACTIVE,
  STATUS.PAST_DUE,
  STATUS.GRACE,
  STATUS.CANCELLED,
]);

/** Accepts a Firestore Timestamp, a Date, an ISO string or epoch millis. */
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

/**
 * Computes what the subscription's status SHOULD be at `now`.
 *
 * @returns {{status: string, changed: boolean, reason: string,
 *            graceEndsAt: number|null, accessGranted: boolean,
 *            deleteDataAt: number|null}}
 */
export function resolveSubscriptionState(sub, now = Date.now(), settings = BILLING_DEFAULTS) {
  const current = sub?.status ?? null;

  const unchanged = (reason, extra = {}) => ({
    status: current,
    changed: false,
    reason,
    graceEndsAt: toMillis(sub?.graceEndsAt),
    accessGranted: ACCESS_GRANTED.has(current),
    deleteDataAt: toMillis(sub?.dataRetentionDeleteAt),
    ...extra,
  });

  const transition = (status, reason, extra = {}) => ({
    status,
    changed: status !== current,
    reason,
    graceEndsAt: extra.graceEndsAt ?? toMillis(sub?.graceEndsAt),
    accessGranted: ACCESS_GRANTED.has(status),
    deleteDataAt: extra.deleteDataAt ?? toMillis(sub?.dataRetentionDeleteAt),
    ...extra,
  });

  // No subscription record at all. Not an error — it is the state before the
  // first checkout — and it must not be coerced into 'locked', which would
  // imply a failed payment that never happened.
  if (!sub || !current) {
    return {
      status: null,
      changed: false,
      reason: 'no_subscription',
      graceEndsAt: null,
      accessGranted: false,
      deleteDataAt: null,
    };
  }

  // A tier comped by the superadmin never expires and is never swept (Q12).
  // Checked first so no later branch can override it.
  if (sub.grantedBySuperadmin === true) {
    return unchanged('granted_by_superadmin');
  }

  const periodEnd = toMillis(sub.currentPeriodEnd);
  const trialEnd = toMillis(sub.trialEndsAt);
  const graceEnd = toMillis(sub.graceEndsAt);

  // 013Fixes / 20: a period paid for early (see paidWindow) begins at
  // `nextPeriodStart` — checked before the trial or period could lock, so the
  // school moves straight into what it paid for. The caller writes `rollover`.
  const nextStart = toMillis(sub.nextPeriodStart);
  if (nextStart != null && now >= nextStart
      && (current === STATUS.TRIALING || current === STATUS.ACTIVE || current === STATUS.CANCELLED)) {
    return {
      ...transition(STATUS.ACTIVE, 'next_period_started', { graceEndsAt: null }),
      changed: true,
      rollover: {
        // The package paid for applies with its period (a queued downgrade
        // must not cost the school the higher package it already paid for).
        ...(sub.nextTier ? { tier: sub.nextTier } : {}),
        currentPeriodStart: nextStart, nextPeriodStart: null, nextTier: null,
        trialEndsAt: null, remindersSent: [], cancelAtPeriodEnd: false,
      },
    };
  }

  switch (current) {
    case STATUS.TRIALING: {
      if (trialEnd == null) return unchanged('trial_no_end_date');
      // Strictly greater-than: at the exact millisecond the trial ends, it has
      // not yet elapsed. Boundary conditions in billing are worth being
      // deliberate about — this one is tested explicitly.
      // 013Fixes / 18: the countdown ran on days 13–14; the end LOCKS.
      if (now > trialEnd) return transition(STATUS.LOCKED, 'trial_ended', { graceEndsAt: null });
      return unchanged('trial_active');
    }

    case STATUS.ACTIVE: {
      if (periodEnd == null) return unchanged('active_no_period_end');
      // 013Fixes / 18: a card subscription waits a few hours for Paystack's
      // renewal webhook (a technical wait, not a grace period); M-Pesa and
      // manual periods lock at their end. Paystack's charge.success moves a
      // locked school back to active when a payment arrives.
      if (sub.renewalMode === 'auto') {
        if (now > periodEnd + hours(settings.cardRenewalToleranceHours)) {
          return transition(STATUS.LOCKED, 'renewal_not_received', { graceEndsAt: null });
        }
        return unchanged('active');
      }
      if (now > periodEnd) return transition(STATUS.LOCKED, 'period_ended', { graceEndsAt: null });
      return unchanged('active');
    }

    case STATUS.PAST_DUE: {
      // past_due opens the grace window. If graceEndsAt was never stamped,
      // derive it rather than locking immediately — failing to write a field
      // must not cost the teacher their 48 hours.
      const effectiveGraceEnd = graceEnd ?? (periodEnd != null ? periodEnd + GRACE_PERIOD_MS : null);

      if (effectiveGraceEnd == null) {
        return transition(STATUS.GRACE, 'past_due_grace_derived', {
          graceEndsAt: now + GRACE_PERIOD_MS,
        });
      }
      if (now > effectiveGraceEnd) {
        return transition(STATUS.LOCKED, 'grace_expired', { graceEndsAt: effectiveGraceEnd });
      }
      return transition(STATUS.GRACE, 'entered_grace', { graceEndsAt: effectiveGraceEnd });
    }

    case STATUS.GRACE: {
      if (graceEnd == null) return unchanged('grace_no_end_date');
      if (now > graceEnd) {
        return transition(STATUS.LOCKED, 'grace_expired', { graceEndsAt: graceEnd });
      }
      return unchanged('in_grace');
    }

    case STATUS.CANCELLED: {
      // Cancelled keeps full access to the end of the paid period (Q8).
      if (periodEnd == null) return unchanged('cancelled_no_period_end');
      if (now > periodEnd) {
        return transition(STATUS.EXPIRED, 'cancelled_period_ended', {
          deleteDataAt: periodEnd + RETENTION_DAYS * 24 * 60 * 60 * 1000,
        });
      }
      return unchanged('cancelled_until_period_end');
    }

    case STATUS.LOCKED:
      return unchanged('locked');

    case STATUS.EXPIRED:
      return unchanged('expired');

    default:
      // An unrecognised status is a data problem, not an access decision.
      // Deny access but do not transition — a human should look at it.
      return {
        status: current,
        changed: false,
        reason: 'unknown_status',
        graceEndsAt: null,
        accessGranted: false,
        deleteDataAt: null,
      };
  }
}

const hours = (n) => Number(n) * 60 * 60 * 1000;

/**
 * 013Fixes / 18 — what the screens show about the period, as epoch millis:
 *   endsAt         when access stops unless the school pays (or, for a card
 *                  expected to renew, when it locks if the renewal never
 *                  arrives);
 *   countdownFrom  when the countdown banner starts (null: none expected —
 *                  a card that renews);
 *   renews         a card subscription expected to renew by itself.
 * Null for a comp school, or when there is no period to show. A function of
 * the stored subscription and the settings only — never the clock — so it
 * can be stored in subscription/public.
 */
export function billingWindow(sub, settings = BILLING_DEFAULTS) {
  if (!sub?.status || sub.grantedBySuperadmin === true) return null;
  const countdown = hours(settings.countdownHours);
  const periodEnd = toMillis(sub.currentPeriodEnd);
  switch (sub.status) {
    case STATUS.TRIALING: {
      // 013Fixes / 20: a trial already paid for runs on to the paid period's end.
      const end = (toMillis(sub.nextPeriodStart) != null ? periodEnd : null) ?? toMillis(sub.trialEndsAt) ?? periodEnd;
      return end == null ? null : { endsAt: end, countdownFrom: end - countdown, renews: false };
    }
    case STATUS.ACTIVE: {
      if (periodEnd == null) return null;
      if (sub.renewalMode === 'auto') {
        const failedAt = toMillis(sub.paymentFailedAt);
        return {
          endsAt: periodEnd + hours(settings.cardRenewalToleranceHours),
          countdownFrom: failedAt ?? null,
          renews: failedAt == null && sub.cancelAtPeriodEnd !== true,
        };
      }
      return { endsAt: periodEnd, countdownFrom: periodEnd - countdown, renews: false };
    }
    case STATUS.CANCELLED:
      return periodEnd == null ? null : { endsAt: periodEnd, countdownFrom: periodEnd - countdown, renews: false };
    case STATUS.PAST_DUE:
    case STATUS.GRACE: {
      // Legacy: a school already in grace counts down to its graceEndsAt.
      const graceEnd = toMillis(sub.graceEndsAt) ?? (periodEnd != null ? periodEnd + GRACE_PERIOD_MS : null);
      return graceEnd == null ? null : { endsAt: graceEnd, countdownFrom: periodEnd ?? graceEnd - GRACE_PERIOD_MS, renews: false };
    }
    default:
      return null;
  }
}

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year (no daylight saving)

/**
 * 013Fixes / 20 — one calendar month after `ms`, like Paystack's monthly
 * cycle: the same day and time next month, by NAIROBI's calendar, clamped to
 * a shorter month (31 Jan → 28 Feb; 29 Feb in a leap year).
 */
export function addCalendarMonth(ms) {
  const local = new Date(ms + NAIROBI_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const daysInNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), daysInNext);
  const next = Date.UTC(y, m + 1, day, local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return next - NAIROBI_OFFSET_MS;
}

/**
 * 013Fixes / 20 — the window a payment buys (owner answers 7 and 8; Q6: one
 * calendar month, no "days"). Shared by superadmin Record payment and the
 * Paystack webhook (in-app M-Pesa and card charges):
 *   - active, or a trial still running, or cancelled but still running: it
 *     starts at the CURRENT END, so an early payment loses no days;
 *   - anything else (locked, expired, a trial that has ended, a comp school,
 *     a legacy grace, no subscription): it starts NOW.
 * A window starting later is QUEUED, not begun: the payment writes
 * `nextPeriodStart` (= from) and moves `currentPeriodEnd` to `to`, and the
 * running period (its start, a trial's 100 SMS units, the usage window) goes
 * on until resolveSubscriptionState rolls it over at `from`.
 * @returns {{ from: number, to: number }}
 */
export function paidWindow(sub, now = Date.now()) {
  let from = now;
  if (sub && sub.grantedBySuperadmin !== true) {
    const running = {
      [STATUS.ACTIVE]: toMillis(sub.currentPeriodEnd),
      [STATUS.CANCELLED]: toMillis(sub.currentPeriodEnd),
      [STATUS.TRIALING]: toMillis(sub.trialEndsAt) ?? toMillis(sub.currentPeriodEnd),
    }[sub.status];
    if (running != null && running > now) from = running;
  }
  return { from, to: addCalendarMonth(from) };
}

/**
 * 013Fixes / 20 — what a payment does to the subscription (Record payment
 * and the Paystack webhook alike): the window from paidWindow; begun now, or
 * queued behind the running period. The plan follows the package paid for,
 * from the start of the period paid for: queued, it waits in `nextTier`
 * until the rollover. A comp ends (the school pays now). Returns the patch
 * and the window.
 */
export function paymentPatch(current, { tier, now = Date.now(), renewalMode = 'manual' }) {
  const window = paidWindow(current, now);
  const base = {
    renewalMode,
    currentPeriodEnd: new Date(window.to),
    grantedBySuperadmin: false,
    graceEndsAt: null,
    paymentFailedAt: null,
    cancelAtPeriodEnd: false,
  };
  if (window.from > now) {
    // Queued: a trial stays a trial (its own SMS units) until it ends.
    const status = current?.status === STATUS.TRIALING ? STATUS.TRIALING : STATUS.ACTIVE;
    return { window, patch: { ...base, status, nextPeriodStart: new Date(window.from), nextTier: tier } };
  }
  return {
    window,
    patch: {
      ...base,
      tier,
      nextTier: null,
      status: STATUS.ACTIVE,
      currentPeriodStart: new Date(window.from),
      nextPeriodStart: null,
      trialEndsAt: null,
      remindersSent: [],
    },
  };
}

/** 013Fixes / 20: the rollover as document fields (dates for the millis). */
export function rolloverFields(rollover) {
  return { ...rollover, currentPeriodStart: new Date(rollover.currentPeriodStart) };
}

/** True when the teacher should retain feature access at `now`. */
export function hasAccess(sub, now = Date.now()) {
  return resolveSubscriptionState(sub, now).accessGranted;
}

/** True when data past its retention window should be purged (Q10). */
export function isDueForDeletion(sub, now = Date.now()) {
  const deleteAt = toMillis(sub?.dataRetentionDeleteAt);
  return deleteAt != null && now > deleteAt;
}

/**
 * Manual-renewal reminder ladder (M-Pesa). Six points: T−7d, T−3d, T−1d, T−2h,
 * at expiry, and at grace midpoint.
 *
 * Card and bank subscriptions auto-renew, so they get no ladder — reminding
 * someone about a payment that will happen by itself trains them to ignore
 * billing mail.
 */
export const REMINDER_OFFSETS_MS = [
  { id: 't_minus_7d', beforeEnd: 7 * 24 * 60 * 60 * 1000 },
  { id: 't_minus_3d', beforeEnd: 3 * 24 * 60 * 60 * 1000 },
  { id: 't_minus_1d', beforeEnd: 24 * 60 * 60 * 1000 },
  { id: 't_minus_2h', beforeEnd: 2 * 60 * 60 * 1000 },
  { id: 'at_expiry', beforeEnd: 0 },
];

export function dueReminders(sub, now = Date.now()) {
  if (sub?.renewalMode !== 'manual') return [];
  if (sub.grantedBySuperadmin === true) return [];

  const periodEnd = toMillis(sub.currentPeriodEnd);
  if (periodEnd == null) return [];

  const sent = new Set(sub.remindersSent ?? []);
  const due = [];

  for (const reminder of REMINDER_OFFSETS_MS) {
    const fireAt = periodEnd - reminder.beforeEnd;
    if (now >= fireAt && !sent.has(reminder.id)) due.push(reminder.id);
  }

  const graceEnd = toMillis(sub.graceEndsAt);
  if (graceEnd != null) {
    const midpoint = graceEnd - GRACE_PERIOD_MS / 2;
    if (now >= midpoint && !sent.has('grace_midpoint')) due.push('grace_midpoint');
  }

  return due;
}

/** Redacted projection safe to expose at `subscription/public`. */
export function publicProjection(sub, settings = BILLING_DEFAULTS) {
  if (!sub) return null;
  // 013Fixes / 18: the window the screens count down to (see billingWindow).
  const window = billingWindow(sub, settings);
  return {
    endsAt: window?.endsAt ?? null,
    countdownFrom: window?.countdownFrom ?? null,
    renews: window?.renews === true,
    tier: sub.tier ?? null,
    status: sub.status ?? null,
    // 013Fixes / 00: a comp plan and the period start, for the plan's window
    // (capacity and SMS allowances count from it; comp uses the calendar month).
    comp: sub.grantedBySuperadmin === true,
    currentPeriodStart: sub.currentPeriodStart ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    graceEndsAt: sub.graceEndsAt ?? null,
    renewalMode: sub.renewalMode ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
    trialEndsAt: sub.trialEndsAt ?? null,
    // Only what the billing page shows. Since Phase 13 / 05 the stored object
    // also holds the replacement and previous Paystack subscription codes and
    // email tokens, which must never reach a client.
    scheduledTierChange: sub.scheduledTierChange?.tier
      ? { tier: sub.scheduledTierChange.tier, effectiveAt: sub.scheduledTierChange.effectiveAt ?? null }
      : null,
    // Deliberately absent: paystackAuthorizationCode, paystackCustomerCode,
    // paystackSubscriptionCode, and everything else that could be replayed
    // against Paystack.
  };
}
