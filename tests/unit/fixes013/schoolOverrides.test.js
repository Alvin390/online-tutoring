import { describe, it, expect } from 'vitest';
import { applySchoolOverrides, cleanSchoolOverrides } from '../../../api/_lib/schoolOverrides.js';
import { resolvePlan } from '../../../api/_lib/schoolPlan.js';
import { creditWindow } from '../../../api/_lib/smsCredits.js';
import { DEFAULT_PLANS } from '../../../api/_lib/plans.js';

/**
 * 013Fixes / 22 — a school's own limits and features, on top of its plan
 * (and the superadmin's plan settings): applied last, by resolvePlan (every
 * gate and screen) and by the SMS units window.
 */

describe('school overrides', () => {
  it('only known keys and well-formed values count', () => {
    expect(cleanSchoolOverrides({ limits: { logins: 7, seats: 3, sessions: -1, smsUnits: 2.5 }, features: { fees: false, magic: true, calendar: 'yes' } }))
      .toEqual({ limits: { logins: 7 }, features: { fees: false } });
    expect(cleanSchoolOverrides(null)).toEqual({ limits: {}, features: {} });
  });

  it('on top of the plan; "custom" only when something applies', () => {
    const base = DEFAULT_PLANS.bronze;
    expect(applySchoolOverrides(base, null)).toEqual({ features: base.features, limits: base.limits, custom: false });
    const c = applySchoolOverrides(base, { limits: { logins: 9 }, features: { mpesaStk: true } });
    expect(c.custom).toBe(true);
    expect(c.limits).toEqual({ ...base.limits, logins: 9 });
    expect(c.features).toEqual({ ...base.features, mpesaStk: true });
  });

  it('after the superadmin\'s plan settings (config/plans)', () => {
    const plan = resolvePlan(
      { tier: 'silver', schoolOverrides: { limits: { logins: 2 } } },
      { silver: { limits: { logins: 5, sessions: 77 } } },
    );
    expect(plan.limits).toMatchObject({ logins: 2, sessions: 77 });
    expect(plan.custom).toBe(true);
  });

  it('the SMS units window uses the school\'s own SMS units', () => {
    const now = Date.parse('2026-12-10T09:00:00Z');
    const sub = { tier: 'bronze', status: 'active', currentPeriodStart: new Date(now - 86_400_000), schoolOverrides: { limits: { smsUnits: 900 } } };
    expect(creditWindow(sub, null, now).units).toBe(900);
    expect(creditWindow({ ...sub, schoolOverrides: null }, null, now).units).toBe(DEFAULT_PLANS.bronze.limits.smsUnits);
  });
});
