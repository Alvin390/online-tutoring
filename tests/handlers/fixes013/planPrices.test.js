import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  fakes, externalCalls, drainWaitUntil,
} from '../_worker.js';

/**
 * 013Fixes / 25 — prices come from the shared Paystack plans. The checkout
 * charges Paystack's amount; the webhook's "charged the plan's price" check
 * accepts the newest price, the one before a change, and the amount the
 * checkout started with; a Paystack outage uses the stored copy; the status
 * call carries the prices for the screens.
 */

const D = 86_400_000;
let db; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx013-price-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/planPrices.js')).__resetPlanPrices();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 10 * D) });
});

const NEW = { PLN_bronze: 500000, PLN_silver: 800000, PLN_gold: 1200000 };
const initialize = (tier, channel = 'mobile_money') => call('/api/billing/initialize', { token: teacher, body: { tier, channel } });
const initCall = () => externalCalls.filter((c) => String(c.url).includes('/transaction/initialize')).pop();
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());
let seq = 4400;
async function charge(data) {
  seq += 1;
  // 013Fixes / 39: an in-app checkout's charge carries the paying teacher
  // (metadata.uid), a user of this school. No checkout record is made here on
  // purpose: the price checks below decide on it.
  await db.doc('users/fx013-price-teacher').set({ role: 'teacher' }, { merge: true });
  const meta = data.metadata ? { metadata: { uid: 'fx013-price-teacher', ...data.metadata } } : {};
  const raw = JSON.stringify({ event: 'charge.success', data: { id: seq, channel: 'mobile_money', ...data, ...meta } });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  return call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
}

describe('the checkout charges the Paystack plan\'s amount', () => {
  it('M-Pesa: the amount sent, recorded on the checkout and returned', async () => {
    fakes.paystack.plans = NEW;
    const res = await initialize('silver');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amountKes).toBe(8000);
    expect(initCall().body.amount).toBe(800000);
    expect((await db.doc(`billing/checkouts/items/${res.body.reference}`).get()).data().amountKes).toBe(8000);
    // Stored for an outage.
    expect((await db.doc('config/planPrices').get()).data().dev.prices).toEqual({ bronze: 5000, silver: 8000, gold: 12000 });
  });

  it('Paystack down: the stored copy', async () => {
    await db.doc('config/planPrices').set({ dev: { prices: { bronze: 5000, silver: 8100, gold: 12000 }, fetchedAt: new Date() } });
    fakes.paystack.fail = { '/plan/': 503 };
    const res = await initialize('silver');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amountKes).toBe(8100);
  });

  it('Paystack down and nothing stored: the code price', async () => {
    fakes.paystack.fail = { '/plan/': 503 };
    const res = await initialize('silver');
    expect(res.body.amountKes).toBe(7499);
  });
});

describe('the webhook\'s price check around a change', () => {
  beforeEach(async () => {
    // The price went from 7,499 to 8,000.
    await db.doc('config/planPrices').set({ dev: { prices: { bronze: 4999, silver: 8000, gold: 9999 }, previous: { bronze: 4999, silver: 7499, gold: 9999 }, fetchedAt: new Date() } });
    fakes.paystack.plans = { PLN_bronze: 499900, PLN_silver: 800000, PLN_gold: 999900 };
  });

  it('the new price, the old one, or the checkout\'s own amount: no mismatch', async () => {
    await charge({ reference: 'p_new', amount: 800000, metadata: { tier: 'silver', renewalMode: 'manual' } });
    await charge({ reference: 'p_old', amount: 749900, metadata: { tier: 'silver', renewalMode: 'manual' } });
    await db.doc('billing/checkouts/items/p_started').set({ reference: 'p_started', tier: 'silver', amountKes: 7600 });
    await charge({ reference: 'p_started', amount: 760000, metadata: { tier: 'silver', renewalMode: 'manual' } });
    expect(await audits('billing.price_mismatch')).toEqual([]);
  });

  it('anything else is recorded loudly (the money has moved, so it is not refused)', async () => {
    const res = await charge({ reference: 'p_odd', amount: 100000, metadata: { tier: 'silver', renewalMode: 'manual' } });
    expect(res.status).toBe(200);
    const [mismatch] = await audits('billing.price_mismatch');
    expect(mismatch.after).toMatchObject({ tier: 'silver', paidKes: 1000, expectedKes: 8000 });
  });
});

describe('the status call carries the prices', () => {
  it('each plan\'s price and where it came from', async () => {
    fakes.paystack.plans = NEW;
    const res = await call('/api/billing/status', { method: 'GET', token: teacher });
    expect(res.status).toBe(200);
    expect(res.body.plan.prices).toEqual({ bronze: 5000, silver: 8000, gold: 12000 });
    expect(res.body.plan.priceSource).toBe('paystack');
  });

  it('read once per 10 minutes, not per request', async () => {
    fakes.paystack.plans = NEW;
    await call('/api/billing/status', { method: 'GET', token: teacher });
    await call('/api/billing/status', { method: 'GET', token: teacher });
    expect(externalCalls.filter((c) => String(c.url).includes('/plan/')).length).toBe(3);
  });
});

// 013Fixes / 27: the account card and Record payment show the server's price.
describe('the Accounts list carries the prices', () => {
  it('each plan\'s price, for the superadmin screens', async () => {
    fakes.paystack.plans = NEW;
    const admin = await userWithClaims('fx013-price-admin', teacherClaims.superadmin);
    const res = await call('/api/admin/users', { token: admin, body: { action: 'list' } });
    expect(res.status).toBe(200);
    expect(res.body.prices).toEqual({ bronze: 5000, silver: 8000, gold: 12000 });
  });
});

// 013Fixes / 28 (release review): a slow Paystack never holds up a dashboard.
describe('the dashboard never waits on Paystack', () => {
  it('a stored copy: the status answers at once while Paystack is slow', async () => {
    await db.doc('config/planPrices').set({ dev: { prices: { bronze: 5000, silver: 8000, gold: 12000 }, fetchedAt: new Date(Date.now() - 3_600_000) } });
    let release;
    fakes.paystack.hold = new Promise((r) => { release = r; });
    const t0 = Date.now();
    // The response itself (the background Paystack read is drained after).
    const res = await call('/api/billing/status', { method: 'GET', token: teacher, drain: false });
    const took = Date.now() - t0;
    release();
    await drainWaitUntil();
    expect(res.status).toBe(200);
    expect(res.body.plan.prices.silver).toBe(8000);
    expect(took).toBeLessThan(2000);
  });
});
