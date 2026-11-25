import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
} from '../_worker.js';

/**
 * 013Fixes / 20 — superadmin "Record payment" (owner answers 7 and 8, Q6:
 * always one calendar month): locked → it starts now; early → it extends
 * from the current end. The plan follows the package paid for; the same
 * M-Pesa code twice is refused; a preview shows the window first; a school
 * paying by card automatically is refused (cancel the card first). The
 * in-app M-Pesa payment (webhook) follows the same window rule.
 */

const D = 86_400_000;
let db; let admin; let teacher; let addCalendarMonth;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-pay-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-pay-teacher', teacherClaims.gold);
  ({ addCalendarMonth } = await import('../../../api/_lib/subscription.js'));
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
});

const record = (body, token = admin) => call('/api/admin/billing', { token, body: { action: 'recordPayment', ...body } });
const sub = async () => (await db.doc('subscription/current').get()).data();
const payments = async () => (await db.collection('billing/payments/items').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ms = (t) => t?.toMillis?.() ?? null;
let seq = 9000;
async function webhook(event) {
  seq += 1;
  const raw = JSON.stringify({ id: seq, ...event });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  return call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
}

describe('recording a payment', () => {
  it('locked: one month from now; the school is active again; recorded and audited', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'locked', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() - 3 * D) });
    const before = Date.now();
    const res = await record({ tier: 'gold', amountKes: 5000, method: 'mpesa', code: 'QXY1Z2W3V4', note: 'Paid to owner' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ tier: 'gold', status: 'active', renewalMode: 'manual', grantedBySuperadmin: false, lastPaymentAmountKes: 5000, lastPaymentMethod: 'mpesa' });
    expect(ms(s.currentPeriodStart)).toBeGreaterThanOrEqual(before - 1000);
    expect(ms(s.currentPeriodEnd)).toBe(addCalendarMonth(ms(s.currentPeriodStart)));
    expect(s.trialEndsAt ?? null).toBeNull();
    const [p] = await payments();
    expect(p).toMatchObject({ id: 'mpesa_QXY1Z2W3V4', amountKes: 5000, method: 'mpesa', kind: 'payment', source: 'manual', tier: 'gold' });
    expect(ms(p.periodFrom)).toBe(ms(s.currentPeriodStart));
    expect(ms(p.periodTo)).toBe(ms(s.currentPeriodEnd));
    expect((await db.collection('audit').where('action', '==', 'billing.payment_recorded').get()).size).toBe(1);
    expect((await db.doc('subscription/public').get()).data()).toMatchObject({ status: 'active', tier: 'gold' });
  });

  it('early: queued from the current end, no days lost (the running period goes on)', async () => {
    const end = Date.now() + 10 * D;
    const start = end - 30 * D;
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(end) });
    const res = await record({ tier: 'silver', amountKes: 3000, method: 'cash' });
    expect(res.body.window).toEqual({ from: end, to: addCalendarMonth(end), startsNow: false });
    const s = await sub();
    expect(s.status).toBe('active');
    expect(ms(s.currentPeriodStart)).toBe(start);
    expect(ms(s.nextPeriodStart)).toBe(end);
    expect(ms(s.currentPeriodEnd)).toBe(addCalendarMonth(end));
    const [p] = await payments();
    expect(ms(p.periodFrom)).toBe(end);
  });

  it('during a trial: queued from the trial\'s end; the trial runs on; another trial is refused', async () => {
    const trialEnd = Date.now() + 4 * D;
    await db.doc('subscription/current').set({ tier: 'gold', status: 'trialing', renewalMode: 'manual', trialEndsAt: new Date(trialEnd), currentPeriodStart: new Date(trialEnd - 10 * D), currentPeriodEnd: new Date(trialEnd) });
    await record({ tier: 'gold', amountKes: 5000, method: 'bank' });
    const s = await sub();
    expect(s.status).toBe('trialing');
    expect(ms(s.nextPeriodStart)).toBe(trialEnd);
    expect(ms(s.currentPeriodEnd)).toBe(addCalendarMonth(trialEnd));
    // Starting another trial now would throw the paid month away.
    const again = await call('/api/admin/billing', { token: admin, body: { action: 'startTrial', tier: 'gold' } });
    expect(again.status).toBe(409);
  });

  it('a Gold school paying early for Bronze keeps Gold to its end; Bronze begins with the paid month', async () => {
    const end = Date.now() + 5 * D;
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(end - 30 * D), currentPeriodEnd: new Date(end) });
    await record({ tier: 'bronze', amountKes: 1500, method: 'cash' });
    const s = await sub();
    expect(s).toMatchObject({ tier: 'gold', nextTier: 'bronze', status: 'active' });
    expect((await db.doc('subscription/public').get()).data().tier).toBe('gold');
    // The running month ends: the status read rolls it over.
    await db.doc('subscription/current').update({ nextPeriodStart: new Date(Date.now() - 60_000) });
    await call('/api/billing/status', { method: 'GET', token: teacher });
    expect(await sub()).toMatchObject({ tier: 'bronze', nextTier: null, nextPeriodStart: null, status: 'active' });
  });

  it('a queued month begins when the running one ends (the status read rolls it over)', async () => {
    const oldEnd = Date.now() - 60_000;
    const newEnd = addCalendarMonth(oldEnd);
    await db.doc('subscription/current').set({ tier: 'silver', status: 'trialing', renewalMode: 'manual', trialEndsAt: new Date(oldEnd), currentPeriodStart: new Date(oldEnd - 14 * D), currentPeriodEnd: new Date(newEnd), nextPeriodStart: new Date(oldEnd), remindersSent: ['trial_2d'] });
    const res = await call('/api/billing/status', { method: 'GET', token: teacher });
    expect(res.status).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ status: 'active', nextPeriodStart: null, trialEndsAt: null, remindersSent: [] });
    expect(ms(s.currentPeriodStart)).toBe(oldEnd);
    expect(ms(s.currentPeriodEnd)).toBe(newEnd);
  });

  it('a preview shows the window and writes nothing', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'locked', renewalMode: 'manual' });
    const res = await record({ tier: 'silver', amountKes: 3000, method: 'cash', preview: true });
    expect(res.status).toBe(200);
    expect(res.body.window.to).toBe(addCalendarMonth(res.body.window.from));
    expect((await sub()).status).toBe('locked');
    expect(await payments()).toEqual([]);
  });
});

describe('refusals', () => {
  it('the same M-Pesa code twice (even one recorded with a trial)', async () => {
    await call('/api/admin/billing', { token: admin, body: { action: 'startTrial', tier: 'gold', payment: { amountKes: 2500, method: 'mpesa', code: 'QXY1Z2W3V4' } } });
    const res = await record({ tier: 'gold', amountKes: 5000, method: 'mpesa', code: 'qxy1z2w3v4' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('payment_code_used');
    expect((await sub()).status).toBe('trialing');
  });

  it('a school paying by card automatically: cancel the card first', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x', currentPeriodEnd: new Date(Date.now() + 10 * D) });
    const res = await record({ tier: 'silver', amountKes: 3000, method: 'cash' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('card_active');
  });

  it('a card school is refused during the renewal wait and when locked; allowed once the card is cancelled', async () => {
    const card = { tier: 'silver', renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x' };
    // Past its end but inside the hours Paystack may still charge the card.
    await db.doc('subscription/current').set({ ...card, status: 'active', currentPeriodEnd: new Date(Date.now() - 2 * 3_600_000) });
    expect((await record({ tier: 'silver', amountKes: 3000, method: 'cash' })).body.error.code).toBe('card_active');
    await db.doc('subscription/current').set({ ...card, status: 'locked', currentPeriodEnd: new Date(Date.now() - 3 * D) });
    expect((await record({ tier: 'silver', amountKes: 3000, method: 'cash', preview: true })).body.error.code).toBe('card_active');
    await db.doc('subscription/current').set({ ...card, status: 'cancelled', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() + 2 * D) });
    const ok = await record({ tier: 'silver', amountKes: 3000, method: 'cash' });
    expect(ok.status).toBe(200);
    expect((await sub()).renewalMode).toBe('manual');
  });

  it('superadmin only', async () => {
    expect((await record({ tier: 'gold', amountKes: 1, method: 'cash' }, teacher)).status).toBe(403);
  });
});

describe('in-app M-Pesa (the webhook) follows the same rule', () => {
  it('an early payment is queued from the current end', async () => {
    const end = Date.now() + 10 * D;
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(end - 30 * D), currentPeriodEnd: new Date(end) });
    await webhook({ event: 'charge.success', data: { reference: 'mpesa_early', amount: 299900, channel: 'mobile_money', metadata: { tier: 'silver', renewalMode: 'manual' } } });
    const s = await sub();
    expect(s.status).toBe('active');
    expect(ms(s.currentPeriodStart)).toBe(end - 30 * D);
    expect(ms(s.nextPeriodStart)).toBe(end);
    expect(ms(s.currentPeriodEnd)).toBe(addCalendarMonth(end));
  });

  it('the same payment delivered twice (Paystack\'s shape: no top-level id) extends once', async () => {
    const end = Date.now() + 10 * D;
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(end - 30 * D), currentPeriodEnd: new Date(end) });
    const raw = JSON.stringify({ event: 'charge.success', data: { id: 4_400_123, reference: 'mpesa_twice', amount: 299900, channel: 'mobile_money', metadata: { tier: 'silver', renewalMode: 'manual' } } });
    const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
    const send = () => call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
    expect((await send()).status).toBe(200);
    const second = await send();
    expect(second.body.duplicate).toBe(true);
    expect(ms((await sub()).currentPeriodEnd)).toBe(addCalendarMonth(end));
  });

  it('a recurring card charge (no metadata) on a gifted school stored as manual keeps the gift (the live school\'s shape)', async () => {
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: true, renewalMode: 'manual', paystackSubscriptionCode: 'SUB_old', currentPeriodEnd: new Date(Date.now() - 11 * D) });
    await webhook({ event: 'charge.success', data: { id: 7_700_001, reference: 'ref_recurring', amount: 999900, channel: 'card', plan: { plan_code: 'PLN_unknown' } } });
    const s = await sub();
    expect(s.grantedBySuperadmin).toBe(true);
    expect(s.nextPeriodStart ?? null).toBeNull();
    expect(s.status).toBe('active');
  });

  it('a locked school starts now', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'locked', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() - 2 * D) });
    const before = Date.now();
    await webhook({ event: 'charge.success', data: { reference: 'mpesa_locked', amount: 299900, channel: 'mobile_money', metadata: { tier: 'silver', renewalMode: 'manual' } } });
    const s = await sub();
    expect(s.status).toBe('active');
    expect(ms(s.currentPeriodStart)).toBeGreaterThanOrEqual(before - 1000);
    expect(ms(s.currentPeriodEnd)).toBe(addCalendarMonth(ms(s.currentPeriodStart)));
  });
});
