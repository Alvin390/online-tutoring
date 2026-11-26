import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
} from '../_worker.js';

/**
 * 013Fixes / 18 — billing settings (`config/billing`, superadmin, audited)
 * and the countdown inside the period: a trial or manual period locks at its
 * end (no grace after); the screens get the window (endsAt, countdownFrom,
 * renews); a failed card payment keeps the school active and starts the
 * countdown; the trial length comes from the settings.
 */

const H = 3_600_000;
const D = 24 * H;
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-billing-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-billing-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc('users/fx013-billing-teacher').set({ role: 'teacher', email: 'teacher@harness.example' });
});

const settings = (body = {}) => call('/api/admin/billing', { token: admin, body: { action: 'settings', ...body } });
const save = (values, token = admin) => call('/api/admin/billing', { token, body: { action: 'saveSettings', settings: values } });
const status = () => call('/api/billing/status', { method: 'GET', token: teacher });
const sub = async () => (await db.doc('subscription/current').get()).data();
let seq = 5000;
async function webhook(event) {
  seq += 1;
  const raw = JSON.stringify({ id: seq, ...event });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  return call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
}

describe('the settings', () => {
  it('defaults until saved; saved values come back; audited', async () => {
    const first = await settings();
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.settings).toEqual({ trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6, reminderFirstDays: 3, reminderSecondDays: 1 });
    const saved = await save({ trialDays: 10, countdownHours: 24, cardRenewalToleranceHours: 4 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await settings()).body.settings).toEqual({ trialDays: 10, countdownHours: 24, cardRenewalToleranceHours: 4, reminderFirstDays: 3, reminderSecondDays: 1 });
    expect((await db.collection('audit').where('action', '==', 'billing.settings_changed').get()).size).toBe(1);
  });

  it('superadmin only; impossible values are refused', async () => {
    expect((await save({ trialDays: 10 }, teacher)).status).toBe(403);
    // 013Fixes / 23: the second reminder must come after the first; at most 30 days.
    for (const bad of [{ trialDays: 0 }, { trialDays: 14, countdownHours: 14 * 24 }, { cardRenewalToleranceHours: 100 }, { countdownHours: 2.5 },
      { reminderFirstDays: 1, reminderSecondDays: 3 }, { reminderFirstDays: 31 }, { reminderSecondDays: -1 }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await save(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await db.doc('config/billing').get()).exists).toBe(false);
    // 0 switches a reminder off; the second alone is fine.
    expect((await save({ reminderFirstDays: 0, reminderSecondDays: 2 })).status).toBe(200);
  });
});

describe('the countdown inside the period', () => {
  it('a trial in its last 48 hours: still a trial, and the screens get the window', async () => {
    const endsAt = Date.now() + 30 * H;
    await db.doc('subscription/current').set({ status: 'trialing', tier: 'gold', renewalMode: 'manual', trialEndsAt: new Date(endsAt), currentPeriodEnd: new Date(endsAt) });
    const res = await status();
    expect(res.body.subscription).toMatchObject({ status: 'trialing', endsAt, countdownFrom: endsAt - 48 * H, renews: false });
    expect(res.body.accessGranted).toBe(true);
  });

  it('a trial that has ended is LOCKED (no grace after the end)', async () => {
    await db.doc('subscription/current').set({ status: 'trialing', tier: 'gold', renewalMode: 'manual', trialEndsAt: new Date(Date.now() - H), currentPeriodEnd: new Date(Date.now() - H) });
    const res = await status();
    expect(res.body.subscription.status).toBe('locked');
    expect(res.body.accessGranted).toBe(false);
    expect((await sub()).status).toBe('locked');
  });

  it('the window follows the saved settings', async () => {
    await save({ trialDays: 14, countdownHours: 24, cardRenewalToleranceHours: 6 });
    const endsAt = Date.now() + 30 * H;
    await db.doc('subscription/current').set({ status: 'trialing', tier: 'gold', renewalMode: 'manual', trialEndsAt: new Date(endsAt), currentPeriodEnd: new Date(endsAt) });
    expect((await status()).body.subscription.countdownFrom).toBe(endsAt - 24 * H);
  });
});

describe('card payments', () => {
  it('a failed payment keeps the school active and starts the countdown; the next success clears it', async () => {
    const periodEnd = Date.now() + 2 * D;
    // A card school (its Paystack subscription and customer), as Paystack sends them.
    await db.doc('subscription/current').set({ status: 'active', tier: 'silver', renewalMode: 'auto', currentPeriodEnd: new Date(periodEnd), paystackSubscriptionCode: 'SUB_silver', paystackCustomerCode: 'CUS_card' });
    await webhook({ event: 'invoice.payment_failed', data: { subscription: { subscription_code: 'SUB_silver' }, customer: { customer_code: 'CUS_card' } } });
    let s = await sub();
    expect(s.status).toBe('active');
    expect(s.paymentFailedAt).toBeTruthy();
    const pub = (await db.doc('subscription/public').get()).data();
    expect(pub).toMatchObject({ renews: false });
    expect(pub.countdownFrom).toBe(s.paymentFailedAt.toMillis());
    await webhook({ event: 'charge.success', data: { reference: 'renew_1', amount: 299900, channel: 'card', plan: { plan_code: 'PLN_silver' }, customer: { customer_code: 'CUS_card' } } });
    s = await sub();
    expect(s.paymentFailedAt ?? null).toBeNull();
    expect((await db.doc('subscription/public').get()).data()).toMatchObject({ renews: true, countdownFrom: null });
  });
});

describe('Start trial', () => {
  it('takes its length from the settings', async () => {
    await save({ trialDays: 10, countdownHours: 48, cardRenewalToleranceHours: 6 });
    const before = Date.now();
    const res = await call('/api/admin/users', { token: admin, body: { action: 'startTrial', uid: 'fx013-billing-teacher', tier: 'gold' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ends = Date.parse(res.body.trialEndsAt);
    expect(ends - before).toBeGreaterThanOrEqual(10 * D - 5000);
    expect(ends - before).toBeLessThanOrEqual(10 * D + 5000);
  });
});
