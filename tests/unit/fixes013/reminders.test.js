import { describe, it, expect } from 'vitest';
import { dueReminders, reminderLadder, BILLING_DEFAULTS } from '../../../api/_lib/subscription.js';
import { buildReminderEmail } from '../../../api/_lib/billingReminders.js';

/**
 * 013Fixes / 23 — the reminder ladder (owner suggestion 7): days before the
 * end from the billing settings (3 and 1 by default; 0 = off), and one when
 * the school locks. Trials and manual (M-Pesa) periods get the ladder; a card
 * school only after a failed payment; gifted and cancelling schools none. The
 * end is the one the school's own countdown shows (billingWindow).
 */

const D = 86_400_000;
const H = 3_600_000;
const NOW = Date.parse('2026-12-10T09:00:00Z');
const S = BILLING_DEFAULTS;

const trial = (end, extra = {}) => ({ tier: 'gold', status: 'trialing', renewalMode: 'manual', trialEndsAt: new Date(end), currentPeriodEnd: new Date(end), ...extra });
const manual = (end, extra = {}) => ({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(end), ...extra });

describe('the ladder', () => {
  it('3 days, 1 day, and at lock by default; 0 switches a step off', () => {
    expect(reminderLadder(S).map((r) => r.id)).toEqual(['days_3', 'days_1', 'at_lock']);
    expect(reminderLadder({ ...S, reminderFirstDays: 5, reminderSecondDays: 0 }).map((r) => r.id)).toEqual(['days_5', 'at_lock']);
  });
});

describe('what is due', () => {
  it('a trial: nothing early; the first step at 3 days; both by 1 day', () => {
    const end = NOW + 5 * D;
    expect(dueReminders(trial(end), NOW, S)).toEqual([]);
    expect(dueReminders(trial(end), end - 3 * D, S)).toEqual(['days_3']);
    expect(dueReminders(trial(end), end - 1 * D, S)).toEqual(['days_3', 'days_1']);
    expect(dueReminders(trial(end, { remindersSent: ['days_3'] }), end - 1 * D, S)).toEqual(['days_1']);
  });

  it('at lock: once the end has passed (and the school locked), within two days', () => {
    const end = NOW - H;
    expect(dueReminders(manual(end, { status: 'locked', remindersSent: ['days_3', 'days_1'] }), NOW, S)).toEqual(['at_lock']);
    // A lock older than two days: nothing (a release must not mail old locks).
    expect(dueReminders(manual(NOW - 3 * D, { status: 'locked' }), NOW, S)).toEqual([]);
  });

  it('a card school: nothing while it renews by itself; the ladder after a failed payment, to the end plus the renewal wait', () => {
    const end = NOW + 2 * D;
    const card = { tier: 'gold', status: 'active', renewalMode: 'auto', currentPeriodEnd: new Date(end) };
    expect(dueReminders(card, end - 1 * D, S)).toEqual([]);
    const failed = { ...card, paymentFailedAt: new Date(NOW) };
    const lockAt = end + S.cardRenewalToleranceHours * H;
    expect(dueReminders(failed, lockAt - 1 * D, S)).toEqual(['days_3', 'days_1']);
  });

  it('gifted, cancelling and legacy grace schools: none', () => {
    const end = NOW + D;
    expect(dueReminders(manual(end, { grantedBySuperadmin: true }), NOW, S)).toEqual([]);
    expect(dueReminders(manual(end, { cancelAtPeriodEnd: true }), NOW, S)).toEqual([]);
    expect(dueReminders(manual(end, { status: 'cancelled', cancelAtPeriodEnd: true }), NOW, S)).toEqual([]);
    expect(dueReminders(manual(NOW - D, { status: 'grace', graceEndsAt: new Date(NOW + D) }), NOW, S)).toEqual([]);
  });

  it('a trial already paid for: counts down to the paid end, not the trial\'s', () => {
    const trialEnd = NOW + D;
    const paidEnd = trialEnd + 31 * D;
    const s = trial(trialEnd, { currentPeriodEnd: new Date(paidEnd), nextPeriodStart: new Date(trialEnd) });
    expect(dueReminders(s, NOW, S)).toEqual([]);
    expect(dueReminders(s, paidEnd - 3 * D, S)).toEqual(['days_3']);
  });
});

describe('the email', () => {
  const end = Date.parse('2026-12-13T14:00:00Z'); // 5:00 pm in Nairobi

  it('a trial, 3 days out: the date in Nairobi, the plan\'s price, where to pay', () => {
    const m = buildReminderEmail({ reminderId: 'days_3', kind: 'trial', tier: 'gold', endsAt: end, priceKes: 5000, baseUrl: 'https://example.test', now: end - 3 * D });
    expect(m.subject).toBe('Your free trial ends in 3 days');
    expect(m.text).toMatch(/Gold/);
    expect(m.text).toMatch(/13 December 2026.*5:00\s?pm/i);
    expect(m.text).toMatch(/KES 5,000 a month/);
    expect(m.text).toMatch(/https:\/\/example\.test\/billing/);
    expect(m.text).not.toMatch(/grace/i);
    // One blank line between paragraphs, the sign-off included.
    expect(m.text).not.toMatch(/\n{3,}/);
    expect(m.text.endsWith('\n\nOnline Tutoring')).toBe(true);
  });

  it('a paid month, 1 day out', () => {
    const m = buildReminderEmail({ reminderId: 'days_1', kind: 'period', tier: 'silver', endsAt: end, priceKes: 3000, baseUrl: 'https://example.test', now: end - D });
    expect(m.subject).toBe('Your plan ends tomorrow');
  });

  it('the wording follows the time actually left, not the step (a school reaching the ladder late)', () => {
    const late = (now) => buildReminderEmail({ reminderId: 'days_3', kind: 'trial', tier: 'gold', endsAt: end, priceKes: 5000, baseUrl: 'https://example.test', now }).subject;
    // 30 hours before 13 Dec 5:00 pm Nairobi is 12 Dec 11:00 am: tomorrow.
    expect(late(end - 30 * H)).toBe('Your free trial ends tomorrow');
    // The same Nairobi day: today.
    expect(late(end - 2 * H)).toBe('Your free trial ends today');
    // 13 Dec 5 pm, from 10 Dec 9 pm Nairobi (2 days 20 h): 3 calendar days.
    expect(late(end - (2 * D + 20 * H))).toBe('Your free trial ends in 3 days');
  });

  it('at lock', () => {
    const m = buildReminderEmail({ reminderId: 'at_lock', kind: 'period', tier: 'silver', endsAt: end, priceKes: 3000, baseUrl: 'https://example.test' });
    expect(m.subject).toBe('Your account is locked');
    expect(m.text).toMatch(/opens again straight away/);
  });

  it('a card payment that failed', () => {
    const m = buildReminderEmail({ reminderId: 'days_1', kind: 'card_failed', tier: 'gold', endsAt: end, priceKes: 5000, baseUrl: 'https://example.test' });
    expect(m.subject).toBe('Your card payment did not go through');
    expect(m.text).toMatch(/locks on 13 December 2026/);
  });
});
