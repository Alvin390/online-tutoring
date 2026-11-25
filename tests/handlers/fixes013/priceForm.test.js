import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  fakes, externalCalls,
} from '../_worker.js';

/**
 * 013Fixes / 26 — the price form (owner: "a form for changing prices for each
 * package that will change everywhere even in Paystack and update
 * immediately"; the new price applies from each school's next payment).
 * Paystack first (PUT /plan/:code, update_existing_subscriptions: true); only
 * then the stored copy, this isolate's cache and the audit. Live mode needs
 * the plan's name typed back. The school's billing page is told.
 */

const D = 86_400_000;
let db; let admin; let teacher;
const PLANS = { PLN_bronze: 499900, PLN_silver: 749900, PLN_gold: 999900 };

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-prices-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-prices-teacher', teacherClaims.silver);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  fakes.paystack.plans = { ...PLANS };
  (await import('../../../api/_lib/planPrices.js')).__resetPlanPrices();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodStart: new Date(Date.now() - 20 * D), currentPeriodEnd: new Date(Date.now() + 10 * D) });
});

const prices = (body, token = admin) => call('/api/admin/prices', { token, body });
const puts = () => externalCalls.filter((c) => String(c.url).includes('/plan/') && c.method === 'PUT');
const status = () => call('/api/billing/status', { method: 'GET', token: teacher });

describe('reading the prices', () => {
  it('the mode, each plan\'s price and where it came from', async () => {
    const res = await prices({ action: 'get' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mode: 'dev', prices: { bronze: 4999, silver: 7499, gold: 9999 }, source: 'paystack' });
  });

  it('"Refresh prices now" asks Paystack again (a change made in another deployment)', async () => {
    await prices({ action: 'get' });
    fakes.paystack.plans.PLN_gold = 1100000;
    expect((await prices({ action: 'get' })).body.prices.gold).toBe(9999); // cached
    expect((await prices({ action: 'refresh' })).body.prices.gold).toBe(11000);
  });
});

describe('changing a price', () => {
  it('Paystack first, for existing subscriptions too; then the stored copy, at once on this deployment; audited', async () => {
    const res = await prices({ action: 'change', tier: 'silver', amountKes: 8000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [put] = puts();
    expect(put.url).toContain('/plan/PLN_silver');
    expect(put.body).toEqual({ amount: 800000, update_existing_subscriptions: true });
    const stored = (await db.doc('config/planPrices').get()).data().dev;
    expect(stored).toMatchObject({ prices: { bronze: 4999, silver: 8000, gold: 9999 }, previous: { silver: 7499 }, changedBy: 'fx013-prices-admin' });
    expect(stored.changedAt).toBeTruthy();
    // At once on this deployment: the status shows the new price (Paystack isn't re-read).
    fakes.paystack.fail = { '/plan/': 503 };
    expect((await status()).body.plan.prices.silver).toBe(8000);
    const [audit] = (await db.collection('audit').where('action', '==', 'billing.price_changed').get()).docs.map((d) => d.data());
    expect(audit).toMatchObject({ before: { silver: 7499 }, after: { silver: 8000 } });
    expect(audit.context).toMatchObject({ mode: 'dev', tier: 'silver' });
  });

  it('Paystack refuses: nothing changes here, and its reason is shown', async () => {
    fakes.paystack.fail = { '/plan/PLN_silver': 400 };
    const res = await prices({ action: 'change', tier: 'silver', amountKes: 8000 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/fake failure/);
    expect((await db.doc('config/planPrices').get()).exists).toBe(false);
    expect((await db.collection('audit').where('action', '==', 'billing.price_changed').get()).size).toBe(0);
  });

  it('whole shillings, at least 1; the plans out of order is only a warning', async () => {
    for (const amountKes of [0, 12.5, -3]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await prices({ action: 'change', tier: 'silver', amountKes })).status).toBe(400);
    }
    const res = await prices({ action: 'change', tier: 'silver', amountKes: 12000 });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/Silver now costs more than Gold/);
  });

  it('superadmin only', async () => {
    expect((await prices({ action: 'get' }, teacher)).status).toBe(403);
    expect((await prices({ action: 'change', tier: 'gold', amountKes: 1 }, teacher)).status).toBe(403);
  });
});

describe('live mode', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['PAYSTACK_MODE', 'PAYSTACK_SECRET_KEY_LIVE', 'PAYSTACK_PLAN_SILVER_LIVE', 'PAYSTACK_PLAN_BRONZE_LIVE', 'PAYSTACK_PLAN_GOLD_LIVE']) saved[k] = process.env[k];
    Object.assign(process.env, { PAYSTACK_MODE: 'live', PAYSTACK_SECRET_KEY_LIVE: 'sk_live_harness_only', PAYSTACK_PLAN_SILVER_LIVE: 'PLN_silver_live', PAYSTACK_PLAN_BRONZE_LIVE: 'PLN_bronze_live', PAYSTACK_PLAN_GOLD_LIVE: 'PLN_gold_live' });
    fakes.paystack.plans = { PLN_bronze_live: 499900, PLN_silver_live: 749900, PLN_gold_live: 999900 };
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('the plan\'s name must be typed back; then it changes', async () => {
    const none = await prices({ action: 'change', tier: 'silver', amountKes: 8000 });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('confirm_name');
    expect((await prices({ action: 'change', tier: 'silver', amountKes: 8000, confirmName: 'Gold' })).body.error.code).toBe('confirm_name');
    expect(puts()).toHaveLength(0);
    const ok = await prices({ action: 'change', tier: 'silver', amountKes: 8000, confirmName: ' silver ' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(puts()[0].url).toContain('/plan/PLN_silver_live');
    expect((await db.doc('config/planPrices').get()).data().live.prices.silver).toBe(8000);
  });
});

describe('the school is told', () => {
  it('its own package\'s new price, from its next payment, until it pays', async () => {
    await prices({ action: 'change', tier: 'silver', amountKes: 8000 });
    const plan = (await status()).body.plan;
    expect(plan.priceChange).toMatchObject({ tier: 'silver', from: 7499, to: 8000 });
    expect(plan.priceChange.fromDate).toBe(new Date((await db.doc('subscription/current').get()).data().currentPeriodEnd.toMillis()).getTime());
    // It pays after the change: no more notice.
    await db.doc('subscription/current').update({ lastPaymentAt: new Date(Date.now() + 1000) });
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    expect((await status()).body.plan.priceChange ?? null).toBeNull();
  });

  it('another package\'s change, or a gifted school: no notice', async () => {
    await prices({ action: 'change', tier: 'gold', amountKes: 11000 });
    expect((await status()).body.plan.priceChange ?? null).toBeNull();
    await prices({ action: 'change', tier: 'silver', amountKes: 8000 });
    await db.doc('subscription/current').update({ grantedBySuperadmin: true });
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    expect((await status()).body.plan.priceChange ?? null).toBeNull();
  });
});
