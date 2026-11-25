import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes, fakes, externalCalls,
} from '../_worker.js';

/**
 * 013Fixes / 21 — payment history (owner suggestion 5):
 *   - every in-app payment (webhook charge.success) is written to
 *     billing/payments with source 'paystack', once even when delivered twice;
 *   - the superadmin list (newest first, 20 a page, codes and notes shown);
 *   - the school's list (the same payments, never a code, note or actor);
 *   - a one-off backfill from billing/events, through Paystack's verify:
 *     a dry run first, no duplicates.
 */

const D = 86_400_000;
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-hist-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-hist-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
});

const adminList = (cursor) => call('/api/admin/billing', { token: admin, body: { action: 'payments', ...(cursor ? { cursor } : {}) } });
const schoolList = (cursor, token = teacher) => call('/api/billing/payments', { token, body: cursor ? { cursor } : {} });
const backfill = (apply) => call('/api/admin/billing', { token: admin, body: { action: 'backfillPayments', ...(apply ? { apply: true } : {}) } });
const items = () => db.collection('billing/payments/items');
const ms = (t) => t?.toMillis?.() ?? null;

function signed(event) {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  return () => call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
}

async function seedPayments(n) {
  const base = Date.now() - n * D;
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await items().doc(`p${String(i).padStart(2, '0')}`).set({
      amountKes: 1000 + i, method: i % 2 ? 'cash' : 'mpesa', code: i % 2 ? null : `QAB${String(i).padStart(7, '0')}`,
      note: `note ${i}`, tier: 'silver', kind: 'payment', source: 'manual', actor: 'fx013-hist-admin',
      periodFrom: new Date(base + i * D), periodTo: new Date(base + (i + 30) * D), createdAt: new Date(base + i * D),
    });
  }
}

describe('in-app payments are recorded', () => {
  it('an M-Pesa charge: one record, source paystack, with the period it bought; twice delivered → once', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'locked', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() - D) });
    const send = signed({ event: 'charge.success', data: { id: 5_500_001, reference: 'ref_hist_1', amount: 299900, channel: 'mobile_money', metadata: { tier: 'silver', renewalMode: 'manual' } } });
    expect((await send()).status).toBe(200);
    expect((await send()).body.duplicate).toBe(true);
    const all = (await items().get()).docs;
    expect(all).toHaveLength(1);
    const p = all[0];
    expect(p.id).toBe('paystack_ref_hist_1');
    expect(p.data()).toMatchObject({ amountKes: 2999, method: 'mpesa', tier: 'silver', kind: 'payment', source: 'paystack', reference: 'ref_hist_1', code: null });
    const s = (await db.doc('subscription/current').get()).data();
    expect(ms(p.data().periodFrom)).toBe(ms(s.currentPeriodStart));
    expect(ms(p.data().periodTo)).toBe(ms(s.currentPeriodEnd));
  });

  it('a card charge is recorded as card', async () => {
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', renewalMode: 'auto', currentPeriodEnd: new Date(Date.now() + D) });
    await signed({ event: 'charge.success', data: { id: 5_500_002, reference: 'ref_hist_card', amount: 499900, channel: 'card', metadata: { tier: 'gold', renewalMode: 'auto' } } })();
    expect((await items().doc('paystack_ref_hist_card').get()).data()).toMatchObject({ method: 'card', amountKes: 4999, source: 'paystack' });
  });
});

describe('the superadmin list', () => {
  it('newest first, 20 a page, then the rest; codes and notes shown', async () => {
    await seedPayments(23);
    const first = await adminList();
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items[0]).toMatchObject({ id: 'p22', amountKes: 1022, method: 'mpesa', code: 'QAB0000022', note: 'note 22', source: 'manual' });
    expect(typeof first.body.items[0].periodFrom).toBe('number');
    expect(first.body.nextCursor).toBeTruthy();
    const second = await adminList(first.body.nextCursor);
    expect(second.body.items.map((i) => i.id)).toEqual(['p02', 'p01', 'p00']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('superadmin only', async () => {
    expect((await call('/api/admin/billing', { token: teacher, body: { action: 'payments' } })).status).toBe(403);
  });
});

describe('the school\'s list', () => {
  it('the same payments, without the code, note or actor', async () => {
    await seedPayments(3);
    const res = await schoolList();
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.id)).toEqual(['p02', 'p01', 'p00']);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['amountKes', 'createdAt', 'id', 'method', 'periodFrom', 'periodTo', 'tier']);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/QAB|note|fx013-hist-admin/);
  });

  it('pages too', async () => {
    await seedPayments(21);
    const first = await schoolList();
    expect(first.body.items).toHaveLength(20);
    expect((await schoolList(first.body.nextCursor)).body.items.map((i) => i.id)).toEqual(['p00']);
  });

  it('needs a signed-in teacher', async () => {
    expect((await call('/api/billing/payments', { body: {} })).status).toBe(401);
  });
});

describe('backfill from billing/events', () => {
  const event = (id, reference, extra = {}) => db.doc(`billing/events/items/${id}`).set({ event: 'charge.success', reference, status: 'processed', receivedAt: new Date(), ...extra });

  beforeEach(async () => {
    await event('e1', 'old_ref_1');
    await event('e2', 'old_ref_2');
    await event('e3', 'old_ref_3');
    await db.doc('billing/events/items/e4').set({ event: 'invoice.create', reference: null, status: 'processed' });
    // Already recorded (by the webhook since this phase): skipped.
    await items().doc('paystack_old_ref_3').set({ amountKes: 1, method: 'mpesa', source: 'paystack', createdAt: new Date() });
    fakes.paystack.verify = {
      old_ref_1: { status: 'success', reference: 'old_ref_1', amount: 299900, channel: 'mobile_money', paid_at: '2026-10-05T07:00:00.000Z', metadata: { tier: 'silver' } },
      old_ref_2: { status: 'abandoned', reference: 'old_ref_2', amount: 499900, channel: 'card' },
    };
  });

  it('a dry run counts and writes nothing (and calls nobody)', async () => {
    const res = await backfill(false);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: false, charges: 3, missing: 2 });
    expect((await items().get()).size).toBe(1);
  });

  it('applied: the successful one is written as it was paid; the abandoned one is not; a second run asks nobody', async () => {
    const res = await backfill(true);
    expect(res.body).toMatchObject({ applied: true, written: 1, notSuccessful: 1, notVerifiable: 0, failed: 0, remaining: 0 });
    const p = (await items().doc('paystack_old_ref_1').get()).data();
    expect(p).toMatchObject({ amountKes: 2999, method: 'mpesa', tier: 'silver', source: 'paystack', backfilled: true, periodFrom: null, periodTo: null });
    expect(ms(p.createdAt)).toBe(Date.parse('2026-10-05T07:00:00.000Z'));
    const verifies = () => externalCalls.filter((c) => String(c.url).includes('/transaction/verify/')).length;
    const before = verifies();
    const again = await backfill(true);
    expect(again.body).toMatchObject({ written: 0, missing: 0 });
    expect(verifies()).toBe(before); // the abandoned one is not asked about again
    expect((await backfill(false)).body).toMatchObject({ missing: 0, settled: 1 });
    expect((await items().get()).size).toBe(2);
    expect((await db.collection('audit').where('action', '==', 'billing.payments_backfilled').get()).size).toBe(2);
  });

  it('a payment Paystack does not know (a test-mode one under the live key): not verifiable, never retried', async () => {
    fakes.paystack.fail = { '/transaction/verify/old_ref_1': 404 };
    const res = await backfill(true);
    expect(res.body).toMatchObject({ written: 0, notVerifiable: 1, notSuccessful: 1, failed: 0, remaining: 0 });
    fakes.paystack.fail = {};
    expect((await backfill(false)).body).toMatchObject({ missing: 0, settled: 2 });
    expect((await items().get()).size).toBe(1);
  });

  it('Paystack down: failed, and tried again on the next run', async () => {
    fakes.paystack.fail = { '/transaction/verify/old_ref_1': 503 };
    const res = await backfill(true);
    expect(res.body).toMatchObject({ written: 0, failed: 1, remaining: 1 });
    fakes.paystack.fail = {};
    expect((await backfill(true)).body).toMatchObject({ written: 1 });
  });

  it('superadmin only', async () => {
    expect((await call('/api/admin/billing', { token: teacher, body: { action: 'backfillPayments' } })).status).toBe(403);
  });
});
