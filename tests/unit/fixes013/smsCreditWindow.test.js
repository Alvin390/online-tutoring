import { describe, it, expect } from 'vitest';
import { creditWindow, creditView } from '../../../api/_lib/smsCredits.js';

/**
 * 013Fixes / 14 — which window a school's SMS units belong to, and what it
 * grants: Bronze 0, Silver 1,000, Gold 3,000; a trial 100 (whatever the plan
 * that has SMS); a comp school the Nairobi calendar month.
 */

const now = Date.parse('2026-11-20T07:00:00Z');
const start = new Date('2026-11-14T13:00:00Z');

describe('creditWindow', () => {
  it('a paying school: its own period, the plan\'s units', () => {
    expect(creditWindow({ tier: 'silver', status: 'active', currentPeriodStart: start }, null, now))
      .toEqual({ windowId: `period-${start.getTime()}`, units: 1000, tier: 'silver', kind: 'period' });
    expect(creditWindow({ tier: 'gold', status: 'past_due', currentPeriodStart: start }, null, now).units).toBe(3000);
    expect(creditWindow({ tier: 'bronze', status: 'active', currentPeriodStart: start }, null, now).units).toBe(0);
  });

  it('a trial: 100 units on a plan with SMS, none on Bronze', () => {
    expect(creditWindow({ tier: 'gold', status: 'trialing', currentPeriodStart: start }, null, now))
      .toMatchObject({ windowId: `trial-${start.getTime()}`, units: 100, kind: 'trial' });
    expect(creditWindow({ tier: 'bronze', status: 'trialing', currentPeriodStart: start }, null, now).units).toBe(0);
  });

  it('a comp school, or one with no period: the Nairobi month', () => {
    expect(creditWindow({ tier: 'gold', status: 'active', grantedBySuperadmin: true, currentPeriodStart: start }, null, now))
      .toEqual({ windowId: 'month-2026-11', units: 3000, tier: 'gold', kind: 'month' });
    // 00:30 on 1 Dec in Nairobi is December's window.
    expect(creditWindow({ tier: 'gold', grantedBySuperadmin: true }, null, Date.parse('2026-11-30T21:30:00Z')).windowId).toBe('month-2026-12');
    expect(creditWindow(null, null, now)).toMatchObject({ windowId: 'month-2026-11', units: 0 });
  });

  it('follows the superadmin\'s plan settings', () => {
    expect(creditWindow({ tier: 'silver', status: 'active', currentPeriodStart: start }, { silver: { limits: { smsUnits: 1500 } } }, now).units).toBe(1500);
  });
});

describe('creditView', () => {
  it('what is left: included first, then top-up', () => {
    expect(creditView({ windowId: 'w', granted: 1000, includedUsed: 400, topup: 50 }))
      .toEqual({ windowId: 'w', granted: 1000, includedUsed: 400, includedLeft: 600, topup: 50, available: 650 });
    expect(creditView({ granted: 100, includedUsed: 150, topup: -3 })).toMatchObject({ includedLeft: 0, topup: 0, available: 0 });
    expect(creditView(null).available).toBe(0);
  });
});
