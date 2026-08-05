import { describe, it, expect } from 'vitest';
import {
  resolveSubscriptionState,
  hasAccess,
  isDueForDeletion,
  dueReminders,
  publicProjection,
  STATUS,
  GRACE_PERIOD_MS,
} from '../../api/_lib/subscription.js';

/**
 * Subscription state machine — Phase 03 D2.
 *
 * The plan calls this the highest-value test surface in the programme, because
 * three separate callers (cron, webhook, on-read check) depend on it agreeing
 * with itself. A disagreement here is an unreproducible lockout bug.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-08-05T12:00:00Z');

const sub = (overrides) => ({
  tier: 'silver',
  renewalMode: 'auto',
  grantedBySuperadmin: false,
  ...overrides,
});

describe('trialing', () => {
  it('stays trialing before the trial ends', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.TRIALING, trialEndsAt: NOW + DAY }),
      NOW
    );
    expect(r.status).toBe(STATUS.TRIALING);
    expect(r.changed).toBe(false);
    expect(r.accessGranted).toBe(true);
  });

  it('is still trialing AT the exact expiry millisecond', () => {
    // Boundary: `now > trialEnd`, not >=. At the exact instant it has not yet
    // elapsed. Worth pinning, because an off-by-one here bills someone early.
    const r = resolveSubscriptionState(
      sub({ status: STATUS.TRIALING, trialEndsAt: NOW }),
      NOW
    );
    expect(r.status).toBe(STATUS.TRIALING);
  });

  it('moves to past_due one millisecond after expiry', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.TRIALING, trialEndsAt: NOW - 1 }),
      NOW
    );
    expect(r.status).toBe(STATUS.PAST_DUE);
    expect(r.changed).toBe(true);
    expect(r.graceEndsAt).toBe(NOW - 1 + GRACE_PERIOD_MS);
  });

  it('retains access immediately after the trial ends (grace window)', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.TRIALING, trialEndsAt: NOW - 1 }),
      NOW
    );
    expect(r.accessGranted).toBe(true);
  });

  it('does not transition when the trial has no end date', () => {
    const r = resolveSubscriptionState(sub({ status: STATUS.TRIALING }), NOW);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('trial_no_end_date');
  });
});

describe('active → past_due', () => {
  it('stays active inside the period', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.ACTIVE, currentPeriodEnd: NOW + 5 * DAY }),
      NOW
    );
    expect(r.status).toBe(STATUS.ACTIVE);
    expect(r.accessGranted).toBe(true);
  });

  it('is still active AT the exact period end', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.ACTIVE, currentPeriodEnd: NOW }),
      NOW
    );
    expect(r.status).toBe(STATUS.ACTIVE);
  });

  it('moves to past_due after the period ends and stamps grace', () => {
    const periodEnd = NOW - HOUR;
    const r = resolveSubscriptionState(
      sub({ status: STATUS.ACTIVE, currentPeriodEnd: periodEnd }),
      NOW
    );
    expect(r.status).toBe(STATUS.PAST_DUE);
    expect(r.graceEndsAt).toBe(periodEnd + GRACE_PERIOD_MS);
  });
});

describe('past_due → grace → locked', () => {
  it('enters grace while inside the window, keeping full access', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.PAST_DUE, graceEndsAt: NOW + 10 * HOUR }),
      NOW
    );
    expect(r.status).toBe(STATUS.GRACE);
    expect(r.accessGranted).toBe(true);
  });

  it('locks once the grace window has passed', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.PAST_DUE, graceEndsAt: NOW - 1 }),
      NOW
    );
    expect(r.status).toBe(STATUS.LOCKED);
    expect(r.accessGranted).toBe(false);
  });

  it('derives grace from currentPeriodEnd when graceEndsAt was never written', () => {
    const periodEnd = NOW - HOUR;
    const r = resolveSubscriptionState(
      sub({ status: STATUS.PAST_DUE, currentPeriodEnd: periodEnd }),
      NOW
    );
    expect(r.status).toBe(STATUS.GRACE);
    expect(r.graceEndsAt).toBe(periodEnd + GRACE_PERIOD_MS);
  });

  it('grants a fresh 48h rather than locking when both dates are missing', () => {
    // A failure to write a field must not cost the teacher their grace period.
    const r = resolveSubscriptionState(sub({ status: STATUS.PAST_DUE }), NOW);
    expect(r.status).toBe(STATUS.GRACE);
    expect(r.graceEndsAt).toBe(NOW + GRACE_PERIOD_MS);
  });

  it('stays in grace AT the exact grace boundary', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.GRACE, graceEndsAt: NOW }),
      NOW
    );
    expect(r.status).toBe(STATUS.GRACE);
    expect(r.changed).toBe(false);
  });

  it('locks one millisecond past the grace boundary', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.GRACE, graceEndsAt: NOW - 1 }),
      NOW
    );
    expect(r.status).toBe(STATUS.LOCKED);
    expect(r.changed).toBe(true);
  });

  it('locked is terminal until a payment arrives', () => {
    const r = resolveSubscriptionState(sub({ status: STATUS.LOCKED }), NOW);
    expect(r.status).toBe(STATUS.LOCKED);
    expect(r.changed).toBe(false);
    expect(r.accessGranted).toBe(false);
  });
});

describe('cancellation', () => {
  it('keeps full access until the period ends', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.CANCELLED, cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 3 * DAY }),
      NOW
    );
    expect(r.status).toBe(STATUS.CANCELLED);
    expect(r.accessGranted).toBe(true);
  });

  it('expires after the period and starts the 90-day retention clock', () => {
    const periodEnd = NOW - HOUR;
    const r = resolveSubscriptionState(
      sub({ status: STATUS.CANCELLED, currentPeriodEnd: periodEnd }),
      NOW
    );
    expect(r.status).toBe(STATUS.EXPIRED);
    expect(r.accessGranted).toBe(false);
    expect(r.deleteDataAt).toBe(periodEnd + 90 * DAY);
  });
});

describe('superadmin grant', () => {
  it('never expires, even with every date long past', () => {
    const r = resolveSubscriptionState(
      sub({
        status: STATUS.ACTIVE,
        grantedBySuperadmin: true,
        currentPeriodEnd: NOW - 400 * DAY,
        graceEndsAt: NOW - 399 * DAY,
      }),
      NOW
    );
    expect(r.status).toBe(STATUS.ACTIVE);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('granted_by_superadmin');
    expect(r.accessGranted).toBe(true);
  });

  it('is checked before every other branch, including a trial that has ended', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.TRIALING, grantedBySuperadmin: true, trialEndsAt: NOW - 100 * DAY }),
      NOW
    );
    expect(r.status).toBe(STATUS.TRIALING);
  });

  it('gets no renewal reminders', () => {
    expect(
      dueReminders(
        sub({
          status: STATUS.ACTIVE,
          renewalMode: 'manual',
          grantedBySuperadmin: true,
          currentPeriodEnd: NOW - DAY,
        }),
        NOW
      )
    ).toEqual([]);
  });
});

describe('edge cases', () => {
  it('treats a missing subscription as no-subscription, not as locked', () => {
    // Coercing "never subscribed" into "locked" would imply a failed payment
    // that never happened, and would show the wrong billing screen.
    const r = resolveSubscriptionState(null, NOW);
    expect(r.status).toBeNull();
    expect(r.reason).toBe('no_subscription');
    expect(r.accessGranted).toBe(false);
  });

  it('denies access on an unrecognised status but does not transition', () => {
    const r = resolveSubscriptionState(sub({ status: 'weird_value' }), NOW);
    expect(r.accessGranted).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.reason).toBe('unknown_status');
  });

  it('accepts Date, ISO string, epoch millis and Firestore Timestamp alike', () => {
    const end = NOW + DAY;
    const shapes = [
      end,
      new Date(end),
      new Date(end).toISOString(),
      { toMillis: () => end },
      { seconds: Math.floor(end / 1000) },
    ];

    for (const currentPeriodEnd of shapes) {
      const r = resolveSubscriptionState(sub({ status: STATUS.ACTIVE, currentPeriodEnd }), NOW);
      expect(r.status).toBe(STATUS.ACTIVE);
    }
  });

  it('is pure — same inputs, same output, no clock read', () => {
    const s = sub({ status: STATUS.ACTIVE, currentPeriodEnd: NOW + DAY });
    expect(resolveSubscriptionState(s, NOW)).toEqual(resolveSubscriptionState(s, NOW));
  });

  it('tolerates clock skew pushing `now` backwards', () => {
    const r = resolveSubscriptionState(
      sub({ status: STATUS.ACTIVE, currentPeriodEnd: NOW + DAY }),
      NOW - 10 * DAY
    );
    expect(r.status).toBe(STATUS.ACTIVE);
  });
});

describe('hasAccess', () => {
  const cases = [
    [STATUS.TRIALING, true],
    [STATUS.ACTIVE, true],
    [STATUS.PAST_DUE, true],
    [STATUS.GRACE, true],
    [STATUS.CANCELLED, true],
    [STATUS.LOCKED, false],
    [STATUS.EXPIRED, false],
  ];

  for (const [status, expected] of cases) {
    it(`${status} → access ${expected}`, () => {
      // Far-future dates so no transition fires and we test the status itself.
      expect(
        hasAccess(
          sub({
            status,
            currentPeriodEnd: NOW + 999 * DAY,
            trialEndsAt: NOW + 999 * DAY,
            graceEndsAt: NOW + 999 * DAY,
          }),
          NOW
        )
      ).toBe(expected);
    });
  }
});

describe('data retention', () => {
  it('is not due before the retention date', () => {
    expect(isDueForDeletion({ dataRetentionDeleteAt: NOW + DAY }, NOW)).toBe(false);
  });

  it('is due after the retention date', () => {
    expect(isDueForDeletion({ dataRetentionDeleteAt: NOW - 1 }, NOW)).toBe(true);
  });

  it('is never due when no retention date is set', () => {
    expect(isDueForDeletion({}, NOW)).toBe(false);
  });
});

describe('manual renewal reminder ladder', () => {
  it('sends nothing for an auto-renewing subscription', () => {
    expect(
      dueReminders(sub({ renewalMode: 'auto', currentPeriodEnd: NOW + HOUR }), NOW)
    ).toEqual([]);
  });

  it('fires T-7d once the window is reached', () => {
    const due = dueReminders(
      sub({ renewalMode: 'manual', currentPeriodEnd: NOW + 7 * DAY - 1 }),
      NOW
    );
    expect(due).toContain('t_minus_7d');
    expect(due).not.toContain('t_minus_3d');
  });

  it('does not repeat a reminder already sent', () => {
    const due = dueReminders(
      sub({
        renewalMode: 'manual',
        currentPeriodEnd: NOW + 7 * DAY - 1,
        remindersSent: ['t_minus_7d'],
      }),
      NOW
    );
    expect(due).not.toContain('t_minus_7d');
  });

  it('has fired all five pre-expiry reminders by expiry', () => {
    const due = dueReminders(sub({ renewalMode: 'manual', currentPeriodEnd: NOW }), NOW);
    expect(due).toEqual(
      expect.arrayContaining(['t_minus_7d', 't_minus_3d', 't_minus_1d', 't_minus_2h', 'at_expiry'])
    );
  });

  it('fires the grace midpoint reminder', () => {
    const due = dueReminders(
      sub({
        renewalMode: 'manual',
        currentPeriodEnd: NOW - HOUR,
        graceEndsAt: NOW + GRACE_PERIOD_MS / 2 - HOUR,
      }),
      NOW
    );
    expect(due).toContain('grace_midpoint');
  });
});

describe('public projection', () => {
  const full = {
    tier: 'gold',
    status: STATUS.ACTIVE,
    currentPeriodEnd: NOW,
    graceEndsAt: null,
    renewalMode: 'auto',
    cancelAtPeriodEnd: false,
    paystackAuthorizationCode: 'AUTH_supersecret',
    paystackCustomerCode: 'CUS_123',
    paystackSubscriptionCode: 'SUB_123',
    paystackPlanCode: 'PLN_123',
  };

  it('never leaks the reusable authorization code', () => {
    const p = publicProjection(full);
    expect(p.paystackAuthorizationCode).toBeUndefined();
  });

  it('leaks no paystack identifier at all', () => {
    const serialized = JSON.stringify(publicProjection(full));
    expect(serialized).not.toMatch(/paystack/i);
    expect(serialized).not.toContain('AUTH_');
    expect(serialized).not.toContain('CUS_');
    expect(serialized).not.toContain('SUB_');
  });

  it('exposes what the billing UI needs', () => {
    const p = publicProjection(full);
    expect(p.tier).toBe('gold');
    expect(p.status).toBe(STATUS.ACTIVE);
    expect(p.renewalMode).toBe('auto');
  });

  it('returns null for a missing subscription', () => {
    expect(publicProjection(null)).toBeNull();
  });
});
