import { describe, it, expect } from 'vitest';
import {
  resolveSubscriptionState, billingWindow, publicProjection, BILLING_DEFAULTS,
} from '../../../api/_lib/subscription.js';

/**
 * 013Fixes / 18 — the countdown runs INSIDE the period, then the school locks
 * (owner answers round 3): a 14-day trial counts down on days 13–14 and locks
 * at the end of day 14; an M-Pesa or manual period the same in its last 48
 * hours. A card subscription is expected to renew: no countdown, and a few
 * hours' technical wait for Paystack's renewal before locking; a failed card
 * payment starts the countdown at once. Comp schools are never touched; a
 * school already in grace keeps its graceEndsAt.
 */

const H = 3_600_000;
const D = 24 * H;
const start = Date.parse('2026-12-01T14:00:00Z');
const trial = (extra = {}) => ({ status: 'trialing', tier: 'gold', renewalMode: 'manual', currentPeriodStart: new Date(start), trialEndsAt: new Date(start + 14 * D), currentPeriodEnd: new Date(start + 14 * D), ...extra });
const manual = (extra = {}) => ({ status: 'active', tier: 'silver', renewalMode: 'manual', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(start + 30 * D), ...extra });
const card = (extra = {}) => ({ status: 'active', tier: 'silver', renewalMode: 'auto', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(start + 30 * D), ...extra });
const inCountdown = (w, now) => w?.countdownFrom != null && now >= w.countdownFrom && now <= w.endsAt;

describe('the settings', () => {
  it('defaults: a 14-day trial, a 48-hour countdown, 6 hours for a card renewal', () => {
    expect(BILLING_DEFAULTS).toEqual({ trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6 });
  });
});

describe('a trial', () => {
  it('day 12: running, no countdown', () => {
    const now = start + 11 * D + 12 * H; // the middle of day 12 (day 13 starts at 12 full days)
    expect(resolveSubscriptionState(trial(), now)).toMatchObject({ status: 'trialing', changed: false, accessGranted: true });
    expect(inCountdown(billingWindow(trial()), now)).toBe(false);
  });

  it('day 13: still running, the countdown is on (the last 48 hours)', () => {
    const now = start + 12 * D + 1;
    expect(resolveSubscriptionState(trial(), now).status).toBe('trialing');
    const w = billingWindow(trial());
    expect(w).toMatchObject({ endsAt: start + 14 * D, countdownFrom: start + 12 * D, renews: false });
    expect(inCountdown(w, now)).toBe(true);
  });

  it('at the last millisecond still running; just after, LOCKED (no grace after the end)', () => {
    expect(resolveSubscriptionState(trial(), start + 14 * D).status).toBe('trialing');
    const after = resolveSubscriptionState(trial(), start + 14 * D + 1);
    expect(after).toMatchObject({ status: 'locked', changed: true, reason: 'trial_ended', accessGranted: false });
  });

  it('follows the settings (a 24-hour countdown)', () => {
    expect(billingWindow(trial(), { ...BILLING_DEFAULTS, countdownHours: 24 }).countdownFrom).toBe(start + 13 * D);
  });
});

describe('an M-Pesa or manual period', () => {
  it('counts down in its last 48 hours, then locks at the end', () => {
    const w = billingWindow(manual());
    expect(w).toMatchObject({ endsAt: start + 30 * D, countdownFrom: start + 28 * D, renews: false });
    expect(resolveSubscriptionState(manual(), start + 29 * D).status).toBe('active');
    expect(resolveSubscriptionState(manual(), start + 30 * D + 1)).toMatchObject({ status: 'locked', reason: 'period_ended' });
  });
});

describe('a card subscription', () => {
  it('renews: no countdown; waits the tolerance for Paystack, then locks', () => {
    const w = billingWindow(card());
    expect(w).toMatchObject({ renews: true, countdownFrom: null, endsAt: start + 30 * D + 6 * H });
    expect(resolveSubscriptionState(card(), start + 30 * D + 5 * H).status).toBe('active');
    expect(resolveSubscriptionState(card(), start + 30 * D + 6 * H + 1)).toMatchObject({ status: 'locked', reason: 'renewal_not_received' });
  });

  it('a failed payment starts the countdown at once', () => {
    const failedAt = start + 30 * D - 3 * H;
    const w = billingWindow(card({ paymentFailedAt: new Date(failedAt) }));
    expect(w).toMatchObject({ renews: false, countdownFrom: failedAt });
    expect(inCountdown(w, failedAt + 1)).toBe(true);
    expect(resolveSubscriptionState(card({ paymentFailedAt: new Date(failedAt) }), failedAt + 1).status).toBe('active');
  });

  it('cancelled: access to the end, then expired (as before)', () => {
    const s = card({ status: 'cancelled', cancelAtPeriodEnd: true });
    expect(billingWindow(s)).toMatchObject({ renews: false, endsAt: start + 30 * D });
    expect(resolveSubscriptionState(s, start + 30 * D + 1).status).toBe('expired');
  });
});

describe('what is left alone', () => {
  it('comp: never swept, no window', () => {
    const comp = manual({ grantedBySuperadmin: true, currentPeriodEnd: new Date(start) });
    expect(resolveSubscriptionState(comp, start + 400 * D)).toMatchObject({ changed: false, reason: 'granted_by_superadmin' });
    expect(billingWindow(comp)).toBeNull();
  });

  it('a school already in grace keeps its graceEndsAt (no sudden lock)', () => {
    const grace = { status: 'grace', tier: 'silver', renewalMode: 'manual', currentPeriodEnd: new Date(start), graceEndsAt: new Date(start + 2 * D) };
    expect(resolveSubscriptionState(grace, start + 1 * D).status).toBe('grace');
    expect(billingWindow(grace)).toMatchObject({ endsAt: start + 2 * D });
    expect(resolveSubscriptionState(grace, start + 2 * D + 1).status).toBe('locked');
  });
});

describe('the public projection carries the window', () => {
  it('endsAt, countdownFrom and renews, as numbers; nothing for a comp school', () => {
    expect(publicProjection(trial())).toMatchObject({ endsAt: start + 14 * D, countdownFrom: start + 12 * D, renews: false });
    expect(publicProjection(card(), { ...BILLING_DEFAULTS, cardRenewalToleranceHours: 2 })).toMatchObject({ endsAt: start + 30 * D + 2 * H, renews: true, countdownFrom: null });
    expect(publicProjection(manual({ grantedBySuperadmin: true }))).toMatchObject({ endsAt: null, countdownFrom: null, renews: false });
  });
});
