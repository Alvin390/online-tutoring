import { describe, it, expect } from 'vitest';
import { paidWindow, addCalendarMonth, resolveSubscriptionState, billingWindow, paymentPatch } from '../../../api/_lib/subscription.js';

/**
 * 013Fixes / 20 — the window a payment buys (owner answers 7 and 8, Q6):
 * one calendar month, like Paystack. Locked, expired or a trial that has
 * ended: it starts NOW. Active, or a trial still running: it starts at the
 * current END (no days lost). Shared by Record payment, in-app M-Pesa and
 * card charges.
 */

const D = 86_400_000;
const now = Date.parse('2026-12-10T09:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

describe('one calendar month', () => {
  it('same day next month, same time', () => {
    expect(iso(addCalendarMonth(Date.parse('2026-12-10T09:00:00Z')))).toBe('2027-01-10T09:00:00.000Z');
  });

  it('a month-end clamps to the shorter month (31 Jan → 28 Feb; 29 Feb in a leap year)', () => {
    // 31 Jan, 10:00 in Nairobi (07:00 UTC).
    expect(iso(addCalendarMonth(Date.parse('2027-01-31T07:00:00Z')))).toBe('2027-02-28T07:00:00.000Z');
    expect(iso(addCalendarMonth(Date.parse('2028-01-31T07:00:00Z')))).toBe('2028-02-29T07:00:00.000Z');
  });

  it('the day is Nairobi\'s: 31 Jan 01:00 in Nairobi is still 30 Jan in UTC', () => {
    // 31 Jan 01:00 Nairobi = 30 Jan 22:00 UTC → 28 Feb 01:00 Nairobi = 27 Feb 22:00 UTC.
    expect(iso(addCalendarMonth(Date.parse('2027-01-30T22:00:00Z')))).toBe('2027-02-27T22:00:00.000Z');
  });
});

describe('where the window starts', () => {
  it('locked or expired: now', () => {
    for (const status of ['locked', 'expired']) {
      const w = paidWindow({ status, currentPeriodEnd: new Date(now - 5 * D) }, now);
      expect(w.from).toBe(now);
      expect(w.to).toBe(addCalendarMonth(now));
    }
  });

  it('active and early: from the current end (no days lost)', () => {
    const end = now + 10 * D;
    expect(paidWindow({ status: 'active', currentPeriodEnd: new Date(end) }, now)).toEqual({ from: end, to: addCalendarMonth(end) });
  });

  it('a trial still running: from its end; a trial already ended: now', () => {
    const trialEnd = now + 3 * D;
    expect(paidWindow({ status: 'trialing', trialEndsAt: new Date(trialEnd), currentPeriodEnd: new Date(trialEnd) }, now).from).toBe(trialEnd);
    expect(paidWindow({ status: 'trialing', trialEndsAt: new Date(now - D) }, now).from).toBe(now);
  });

  it('a comp school, a legacy grace, or no subscription: now', () => {
    expect(paidWindow({ status: 'active', grantedBySuperadmin: true, currentPeriodEnd: new Date(now + 20 * D) }, now).from).toBe(now);
    expect(paidWindow({ status: 'grace', currentPeriodEnd: new Date(now - D), graceEndsAt: new Date(now + D) }, now).from).toBe(now);
    expect(paidWindow(null, now).from).toBe(now);
  });

  it('cancelled but still running: from its end', () => {
    const end = now + 4 * D;
    expect(paidWindow({ status: 'cancelled', currentPeriodEnd: new Date(end) }, now).from).toBe(end);
  });
});

// A window starting later is QUEUED: the running period goes on, then rolls over.
describe('an early payment queues the next period', () => {
  it('active: runs on to the old end, then the new period begins (not locked)', () => {
    const oldEnd = now + 5 * D;
    const newEnd = addCalendarMonth(oldEnd);
    const s = { status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(oldEnd - 30 * D), currentPeriodEnd: new Date(newEnd), nextPeriodStart: new Date(oldEnd) };
    expect(resolveSubscriptionState(s, now)).toMatchObject({ status: 'active', changed: false });
    expect(billingWindow(s)).toMatchObject({ endsAt: newEnd });
    const rolled = resolveSubscriptionState(s, oldEnd);
    expect(rolled).toMatchObject({ status: 'active', changed: true, reason: 'next_period_started' });
    expect(rolled.rollover).toEqual({ currentPeriodStart: oldEnd, nextPeriodStart: null, nextTier: null, trialEndsAt: null, remindersSent: [], cancelAtPeriodEnd: false });
  });

  it('a trial paid for: stays a trial (its 100 SMS units) to its end, no countdown, then active', () => {
    const trialEnd = now + 3 * D;
    const newEnd = addCalendarMonth(trialEnd);
    const s = { status: 'trialing', renewalMode: 'manual', trialEndsAt: new Date(trialEnd), currentPeriodEnd: new Date(newEnd), nextPeriodStart: new Date(trialEnd) };
    expect(resolveSubscriptionState(s, trialEnd - 1).status).toBe('trialing');
    expect(billingWindow(s)).toMatchObject({ endsAt: newEnd, countdownFrom: newEnd - 48 * 3_600_000 });
    const after = resolveSubscriptionState(s, trialEnd + 1);
    expect(after.status).toBe('active');
    expect(after.rollover.currentPeriodStart).toBe(trialEnd);
  });
});

describe('the package paid for applies with its period', () => {
  it('queued: the tier waits in nextTier (a Gold school paying early for Bronze keeps Gold to its end)', () => {
    const end = now + 6 * D;
    const { patch } = paymentPatch({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(end) }, { tier: 'bronze', now });
    expect(patch.tier).toBeUndefined();
    expect(patch.nextTier).toBe('bronze');
    expect(patch.status).toBe('active');
    const rolled = resolveSubscriptionState({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodEnd: patch.currentPeriodEnd, nextPeriodStart: patch.nextPeriodStart, nextTier: 'bronze' }, end);
    expect(rolled.rollover).toMatchObject({ tier: 'bronze', nextTier: null });
  });

  it('begun now: the tier changes now and any queued one is cleared', () => {
    const { patch } = paymentPatch({ tier: 'silver', status: 'locked' }, { tier: 'gold', now });
    expect(patch).toMatchObject({ tier: 'gold', nextTier: null, nextPeriodStart: null, status: 'active' });
  });
});
