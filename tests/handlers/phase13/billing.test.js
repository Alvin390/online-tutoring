import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  setFlags, externalCalls, fakes, resetFakes,
} from '../_worker.js';

/**
 * Phase 13 / 05 — billing downgrades and claim sync.
 * Ports B9a, B9b and S-claims to assert the FIX. The fake Paystack records
 * every request body, so these assert exactly what would have been sent.
 */

const OWNER = 'p13-billing-owner';
let db;
let gold;
let authRest;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  authRest = await import('../../../api/_lib/authRest.js');
  gold = await userWithClaims(OWNER, teacherClaims.gold, { email: 'owner@harness.example' });
});

const PERIOD_END = new Date(Date.now() + 10 * 86_400_000);

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  await setFlags(db, { 'billing.enabled': true });
  await authRest.setCustomUserClaims(OWNER, teacherClaims.gold);
  await db.doc(`users/${OWNER}`).set({ role: 'teacher', email: 'owner@harness.example' });
  await db.doc('subscription/current').set({
    status: 'active', tier: 'gold', renewalMode: 'auto',
    paystackCustomerCode: 'CUS_owner', paystackAuthorizationCode: 'AUTH_owner',
    paystackSubscriptionCode: 'SUB_gold', paystackEmailToken: 'tok_gold', paystackPlanCode: 'PLN_gold',
    currentPeriodEnd: PERIOD_END,
  });
});

const paystack = (pathFragment) => externalCalls.filter((c) => c.url.startsWith('https://api.paystack.co') && c.url.includes(pathFragment));

async function webhook(event) {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  return call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
}

const sub = async () => (await db.doc('subscription/current').get()).data();
let eventSeq = 1000;
const eventId = () => { eventSeq += 1; return eventSeq; };

// ---------------------------------------------------------------------------
describe('D1 scheduling a card downgrade changes the plan at Paystack (B9a)', () => {
  it('creates the Bronze subscription starting at period end, then disables the Gold one', async () => {
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const created = paystack('/subscription').filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/subscription');
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({ customer: 'CUS_owner', plan: 'PLN_bronze', authorization: 'AUTH_owner' });
    expect(new Date(created[0].body.start_date).getTime()).toBe(PERIOD_END.getTime());

    const disabled = paystack('/subscription/disable');
    expect(disabled).toHaveLength(1);
    expect(disabled[0].body).toEqual({ code: 'SUB_gold', token: 'tok_gold' });

    const s = await sub();
    expect(s.tier).toBe('gold');
    expect(s.paystackSubscriptionCode).toBe('SUB_gold');
    expect(s.scheduledTierChange).toMatchObject({ tier: 'bronze', previousSubscriptionCode: 'SUB_gold' });
    expect(s.scheduledTierChange.newSubscriptionCode).toMatch(/^SUB_fake_/);
  });

  it('the public projection never carries Paystack codes or tokens', async () => {
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    const pub = (await db.doc('subscription/public').get()).data();
    expect(Object.keys(pub.scheduledTierChange).sort()).toEqual(['effectiveAt', 'tier']);
    expect(JSON.stringify(pub)).not.toMatch(/SUB_|tok_|AUTH_|CUS_/);
  });

  it('full sequence: create webhook for the new code changes nothing; the Bronze renewal applies it', async () => {
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    const newCode = (await sub()).scheduledTierChange.newSubscriptionCode;
    const disablesBefore = paystack('/subscription/disable').length;

    await webhook({ id: eventId(), event: 'subscription.create', data: { subscription_code: newCode, email_token: 'tok_new', plan: { plan_code: 'PLN_bronze' }, next_payment_date: PERIOD_END.toISOString() } });
    let s = await sub();
    expect(s.tier).toBe('gold');
    expect(s.paystackSubscriptionCode).toBe('SUB_gold');
    expect(paystack('/subscription/disable').length).toBe(disablesBefore);

    await webhook({ id: eventId(), event: 'charge.success', data: { reference: 'renew_bronze', amount: 499900, channel: 'card', plan: { plan_code: 'PLN_bronze' }, authorization: { reusable: true, authorization_code: 'AUTH_owner' } } });
    s = await sub();
    expect(s.tier).toBe('bronze');
    expect(s.lastPaymentAmountKes).toBe(4999);
    expect(s.paystackSubscriptionCode).toBe(newCode);
    expect(s.paystackPlanCode).toBe('PLN_bronze');
    expect(s.scheduledTierChange).toBeNull();
  });

  it('a renewal still on the OLD plan does not apply the downgrade', async () => {
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    await webhook({ id: eventId(), event: 'charge.success', data: { reference: 'r_old', amount: 999900, channel: 'card', plan: { plan_code: 'PLN_gold' } } });
    const s = await sub();
    expect(s.tier).toBe('gold');
    expect(s.scheduledTierChange.tier).toBe('bronze');
  });

  it('failure injection: create fails → nothing changes', async () => {
    fakes.paystack.fail = { '/subscription': 400 };
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await sub()).scheduledTierChange).toBeUndefined();
    expect(paystack('/subscription/disable')).toHaveLength(0);
  });

  it('failure injection: disabling the old one fails → the new one is disabled (compensation)', async () => {
    fakes.paystack.fail = { '/subscription/disable': 400 };
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const disables = paystack('/subscription/disable').map((c) => c.body.code);
    expect(disables[0]).toBe('SUB_gold');
    expect(disables[1]).toMatch(/^SUB_fake_/);
    expect((await sub()).scheduledTierChange).toBeUndefined();
  });

  it('manual (M-Pesa) mode: no Paystack calls, schedule stored', async () => {
    await db.doc('subscription/current').set({ renewalMode: 'manual', paystackSubscriptionCode: null }, { merge: true });
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'silver' } });
    expect(res.status).toBe(200);
    expect(paystack('/subscription')).toHaveLength(0);
    expect((await sub()).scheduledTierChange).toMatchObject({ tier: 'silver' });
  });
});

// ---------------------------------------------------------------------------
describe('D2 an upgrade always wins (B9b)', () => {
  it('a paid Gold upgrade while a downgrade is pending lands as Gold and cancels the pending one', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', paystackPlanCode: 'PLN_silver' }, { merge: true });
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    const pending = (await sub()).scheduledTierChange.newSubscriptionCode;

    await webhook({ id: eventId(), event: 'charge.success', data: { reference: 'sub_gold_up', amount: 999900, channel: 'card', plan: { plan_code: 'PLN_gold' }, metadata: { uid: OWNER, tier: 'gold', renewalMode: 'auto' }, authorization: { reusable: true, authorization_code: 'AUTH_owner' } } });

    const s = await sub();
    expect(s.tier).toBe('gold');
    expect(s.scheduledTierChange).toBeNull();
    expect(paystack('/subscription/disable').map((c) => c.body.code)).toContain(pending);
  });
});

// ---------------------------------------------------------------------------
describe('D3 undo', () => {
  it('cancel_downgrade disables the new subscription, re-enables the old one, clears the schedule', async () => {
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    const pending = (await sub()).scheduledTierChange.newSubscriptionCode;

    const res = await call('/api/billing/manage', { token: gold, body: { action: 'cancel_downgrade' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(paystack('/subscription/disable').at(-1).body.code).toBe(pending);
    expect(paystack('/subscription/enable').at(-1).body).toEqual({ code: 'SUB_gold', token: 'tok_gold' });
    expect((await sub()).scheduledTierChange).toBeNull();
  });

  it('a failed re-enable is flagged needsManualAction and tells the teacher to renew manually', async () => {
    await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    fakes.paystack.fail = { '/subscription/enable': 400 };
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'cancel_downgrade' } });
    expect(res.status).toBe(200);
    expect(res.body.manualRenewalNeeded).toBe(true);
    const audits = await db.collection('audit').where('context.needsManualAction', '==', true).get();
    expect(audits.size).toBeGreaterThanOrEqual(1);
  });

  it('nothing scheduled → 400', async () => {
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'cancel_downgrade' } });
    expect(res.status).toBe(400);
  });

  it('webhook replays are no-ops', async () => {
    const evt = { id: 777777, event: 'charge.success', data: { reference: 'replay', amount: 999900, plan: { plan_code: 'PLN_gold' } } };
    await webhook(evt);
    const first = await sub();
    const again = await webhook(evt);
    expect(again.body.duplicate).toBe(true);
    expect((await sub()).lastPaymentAt.toMillis()).toBe(first.lastPaymentAt.toMillis());
  });
});

// ---------------------------------------------------------------------------
describe('D4 claims always follow the subscription (S-claims)', () => {
  it('checkout stores ownerUid on the subscription', async () => {
    await call('/api/billing/initialize', { token: gold, body: { tier: 'gold', channel: 'card' } });
    expect((await sub()).ownerUid).toBe(OWNER);
  });

  it('a renewal with no metadata syncs the owner claims via ownerUid', async () => {
    await db.doc('subscription/current').set({ ownerUid: OWNER, scheduledTierChange: { tier: 'silver', newSubscriptionCode: 'SUB_new', newEmailToken: 't' } }, { merge: true });
    await webhook({ id: eventId(), event: 'charge.success', data: { reference: 'r2', amount: 749900, plan: { plan_code: 'PLN_silver' } } });
    expect((await sub()).tier).toBe('silver');
    expect((await authRest.getUser(OWNER)).customClaims).toMatchObject({ tier: 'silver', tierRank: 2 });
  });

  it('the hourly sweep repairs drifted claims and backfills the owner', async () => {
    // Production today: no ownerUid; one teacher; claim says gold, doc says silver.
    await db.doc('subscription/current').set({ tier: 'silver' }, { merge: true });
    const res = await call('/api/cron/subscriptionSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
    expect(res.status).toBe(200);
    expect((await sub()).ownerUid).toBe(OWNER);
    expect((await authRest.getUser(OWNER)).customClaims).toMatchObject({ tier: 'silver', subActive: true });
  });

  it('backfill is skipped (and audited) when there is more than one teacher', async () => {
    await db.doc('users/someone-else').set({ role: 'teacher' });
    await db.doc('subscription/current').set({ tier: 'silver' }, { merge: true });
    await call('/api/cron/subscriptionSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
    expect((await sub()).ownerUid).toBeUndefined();
    const audit = await db.collection('audit').where('action', '==', 'billing.owner_backfill_skipped').get();
    expect(audit.size).toBe(1);
  });

  it('a price that does not match the plan is audited, not rejected', async () => {
    await webhook({ id: eventId(), event: 'charge.success', data: { reference: 'odd', amount: 123400, plan: { plan_code: 'PLN_gold' } } });
    expect((await sub()).tier).toBe('gold');
    const audit = await db.collection('audit').where('action', '==', 'billing.price_mismatch').get();
    expect(audit.size).toBe(1);
  });
});
