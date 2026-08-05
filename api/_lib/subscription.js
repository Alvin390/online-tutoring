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
 *   trialing   14 days, no card. Full tier access.
 *   active     normal.
 *   past_due   auto: a charge failed. manual: the period ended unpaid.
 *   grace      48 hours after past_due. FULL ACCESS RETAINED. The countdown
 *              clock lives here.
 *   locked     billing page only. Students see "temporarily unavailable".
 *   cancelled  cancelAtPeriodEnd, full access until currentPeriodEnd.
 *   expired    cancelled and elapsed. 90-day retention clock starts.
 */

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
export function resolveSubscriptionState(sub, now = Date.now()) {
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

  switch (current) {
    case STATUS.TRIALING: {
      if (trialEnd == null) return unchanged('trial_no_end_date');
      // Strictly greater-than: at the exact millisecond the trial ends, it has
      // not yet elapsed. Boundary conditions in billing are worth being
      // deliberate about — this one is tested explicitly.
      if (now > trialEnd) {
        return transition(STATUS.PAST_DUE, 'trial_ended', {
          graceEndsAt: trialEnd + GRACE_PERIOD_MS,
        });
      }
      return unchanged('trial_active');
    }

    case STATUS.ACTIVE: {
      if (periodEnd == null) return unchanged('active_no_period_end');
      if (now > periodEnd) {
        // Auto-renewal has not landed, or a manual renewal was not made.
        // Either way the period has lapsed; Paystack's charge.success webhook
        // moves it back to active if a payment arrives.
        return transition(STATUS.PAST_DUE, 'period_ended', {
          graceEndsAt: periodEnd + GRACE_PERIOD_MS,
        });
      }
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
export function publicProjection(sub) {
  if (!sub) return null;
  return {
    tier: sub.tier ?? null,
    status: sub.status ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    graceEndsAt: sub.graceEndsAt ?? null,
    renewalMode: sub.renewalMode ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
    trialEndsAt: sub.trialEndsAt ?? null,
    scheduledTierChange: sub.scheduledTierChange ?? null,
    // Deliberately absent: paystackAuthorizationCode, paystackCustomerCode,
    // paystackSubscriptionCode, and everything else that could be replayed
    // against Paystack.
  };
}
