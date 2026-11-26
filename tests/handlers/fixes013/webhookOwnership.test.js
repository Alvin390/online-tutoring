import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  drainWaitUntil, externalCalls,
} from '../_worker.js';

/**
 * 013Fixes / 39 — the Paystack webhook acts only on THIS school's events.
 *
 * Found while checking live readiness (owner, 2026-11-26): the webhook acted
 * on any successful charge on the Paystack account (a payment link, another
 * school sharing the account, a KES 100 check) and on any subscription event.
 * Now each event must be tied to this school by its own identifiers:
 *   charge.success     a checkout we recorded for the reference; or one of our
 *                      plans charged to a customer this school knows (stored,
 *                      or on one of its checkouts); or metadata.uid of a user
 *                      in this school
 *   subscription.create  a customer this school knows, or the replacement a
 *                      scheduled downgrade created
 *   subscription.disable / not_renew  only the school's CURRENT code, and not
 *                      one the app itself disabled (a plan change)
 *   invoice.*          the school's subscription code, or a known customer
 * Anything else: 200 (no retry), recorded as `not_ours` with non-personal
 * identifiers, audited, and the school untouched.
 */

const OWNER = 'fx013-own-owner';
const D = 86_400_000;
const PERIOD_END = new Date(Date.now() + 20 * D);
let db; let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims(OWNER, teacherClaims.gold);
});

const BASE_SUB = {
  status: 'active', tier: 'gold', renewalMode: 'auto', grantedBySuperadmin: false,
  paystackCustomerCode: 'CUS_owner', paystackAuthorizationCode: 'AUTH_owner',
  paystackSubscriptionCode: 'SUB_gold', paystackEmailToken: 'tok_gold', paystackPlanCode: 'PLN_gold',
  currentPeriodEnd: PERIOD_END,
};

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  await setFlags(db, { 'billing.enabled': true });
  await db.doc(`users/${OWNER}`).set({ role: 'teacher', email: 'owner@harness.example' });
  await db.doc('subscription/current').set(BASE_SUB);
});

let seq = 77000;
async function webhook(event, data) {
  seq += 1;
  const raw = JSON.stringify({ id: seq, event, data: { domain: 'test', ...data } });
  const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
  const res = await call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } });
  return { res, id: String(seq) };
}
const sub = async () => (await db.doc('subscription/current').get()).data();
const eventDoc = async (id) => (await db.doc(`billing/events/items/${id}`).get()).data();
const payments = async () => (await db.collection('billing/payments/items').get()).docs.map((d) => d.data());
const audits = async (action) => { await drainWaitUntil(); return (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data()); };

async function expectNotOurs({ res, id }, before) {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const ev = await eventDoc(id);
  expect(ev.status).toBe('not_ours');
  expect(JSON.stringify(ev)).not.toMatch(/@/);
  expect(await sub()).toEqual(before);
}

describe('not this school\'s: recorded, never acted on', () => {
  it('a one-off charge the app never started (a payment link): school untouched, no payment, audited', async () => {
    const before = await sub();
    const r = await webhook('charge.success', { id: 1, reference: 'link_abc123', amount: 1000000, channel: 'card', customer: { customer_code: 'CUS_stranger', email: 'someone@else.example' } });
    await expectNotOurs(r, before);
    expect(await payments()).toHaveLength(0);
    const [a] = await audits('billing.webhook_ignored');
    expect(a).toMatchObject({ context: expect.objectContaining({ event: 'charge.success', reference: 'link_abc123', reason: 'not_ours' }) });
    expect(JSON.stringify(a)).not.toMatch(/someone@else/);
  });

  it('the KES 100 live check (no checkout, unknown customer): ignored', async () => {
    const before = await sub();
    await expectNotOurs(await webhook('charge.success', { id: 2, reference: 'livecheck_001', amount: 10000, channel: 'mobile_money', customer: { customer_code: 'CUS_owner_live_unknown' } }), before);
  });

  it('our plan, but another customer (another school on a shared account): ignored', async () => {
    const before = await sub();
    await expectNotOurs(await webhook('charge.success', { id: 3, reference: 'renew_other', amount: 1499900, channel: 'card', plan: { plan_code: 'PLN_gold' }, customer: { customer_code: 'CUS_other_school' } }), before);
  });

  it('a subscription created for an unknown customer: ignored (the school keeps its own)', async () => {
    const before = await sub();
    await expectNotOurs(await webhook('subscription.create', { subscription_code: 'SUB_other', email_token: 'tok_o', plan: { plan_code: 'PLN_gold' }, customer: { customer_code: 'CUS_other_school' }, next_payment_date: PERIOD_END.toISOString() }), before);
    expect(externalCalls.filter((c) => String(c.url).includes('/subscription/disable'))).toHaveLength(0);
  });

  it('a disable for a subscription that isn\'t the school\'s current one: ignored', async () => {
    const before = await sub();
    await expectNotOurs(await webhook('subscription.disable', { subscription_code: 'SUB_someone_else', customer: { customer_code: 'CUS_other_school' } }), before);
  });

  it('a failed invoice for another subscription: ignored', async () => {
    const before = await sub();
    await expectNotOurs(await webhook('invoice.payment_failed', { subscription: { subscription_code: 'SUB_other' }, customer: { customer_code: 'CUS_other_school' } }), before);
  });

  it('a "not ours" charge is never backfilled into the payment history', async () => {
    await webhook('charge.success', { id: 4, reference: 'link_zzz', amount: 1000000, channel: 'card', customer: { customer_code: 'CUS_stranger' } });
    const admin = await userWithClaims('fx013-own-admin', teacherClaims.superadmin);
    const res = await call('/api/admin/billing', { token: admin, body: { action: 'backfillPayments' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.charges).toBe(0);
  });
});

describe('this school\'s: processed as before', () => {
  it('a charge for a checkout we recorded (first card charge / M-Pesa)', async () => {
    await db.doc('billing/checkouts/items/sub_gold_abc').set({ reference: 'sub_gold_abc', tier: 'gold', channel: 'mobile_money', renewalMode: 'manual', uid: OWNER, customerCode: 'CUS_new_live', amountKes: 14999, status: 'initialized', createdAt: new Date() });
    const { res, id } = await webhook('charge.success', { id: 5, reference: 'sub_gold_abc', amount: 1499900, channel: 'mobile_money', metadata: { uid: OWNER, tier: 'gold', renewalMode: 'manual' }, customer: { customer_code: 'CUS_new_live' } });
    expect(res.status).toBe(200);
    expect((await eventDoc(id)).status).toBe('processed');
    expect(await payments()).toHaveLength(1);
  });

  it('a card renewal: our plan, the school\'s stored customer, no checkout', async () => {
    const { id } = await webhook('charge.success', { id: 6, reference: 'renewal_ref', amount: 1499900, channel: 'card', plan: { plan_code: 'PLN_gold' }, customer: { customer_code: 'CUS_owner' }, authorization: { reusable: true, authorization_code: 'AUTH_owner' } });
    expect((await eventDoc(id)).status).toBe('processed');
    expect((await sub()).lastPaymentAmountKes).toBe(14999);
  });

  it('the subscription created for a checkout\'s customer, even before its charge arrives', async () => {
    await db.doc('billing/checkouts/items/sub_silver_x').set({ reference: 'sub_silver_x', tier: 'silver', channel: 'card', renewalMode: 'auto', uid: OWNER, customerCode: 'CUS_card_new', amountKes: 9999, status: 'initialized', createdAt: new Date() });
    const { id } = await webhook('subscription.create', { subscription_code: 'SUB_silver_new', email_token: 'tok_s', plan: { plan_code: 'PLN_silver' }, customer: { customer_code: 'CUS_card_new' }, next_payment_date: PERIOD_END.toISOString() });
    expect((await eventDoc(id)).status).toBe('processed');
    expect((await sub()).paystackSubscriptionCode).toBe('SUB_silver_new');
  });

  it('the school\'s own subscription disabled (cancelled in Paystack): cancels, as before', async () => {
    const { id } = await webhook('subscription.disable', { subscription_code: 'SUB_gold', customer: { customer_code: 'CUS_owner' } });
    expect((await eventDoc(id)).status).toBe('processed');
    expect(await sub()).toMatchObject({ status: 'cancelled', cancelAtPeriodEnd: true });
  });

  it('the school\'s own invoice failed: the countdown starts, as before', async () => {
    const { id } = await webhook('invoice.payment_failed', { subscription: { subscription_code: 'SUB_gold' }, customer: { customer_code: 'CUS_owner' } });
    expect((await eventDoc(id)).status).toBe('processed');
    expect((await sub()).paymentFailedAt).toBeTruthy();
  });
});

describe('a disable the app caused itself never cancels the school', () => {
  it('after an upgrade: the OLD subscription\'s disable is ignored; the school stays active on the new one', async () => {
    await db.doc('billing/checkouts/items/sub_gold_up').set({ reference: 'sub_gold_up', tier: 'gold', channel: 'card', renewalMode: 'auto', uid: OWNER, customerCode: 'CUS_owner', amountKes: 14999, status: 'initialized', createdAt: new Date() });
    await webhook('subscription.create', { subscription_code: 'SUB_gold_v2', email_token: 'tok_v2', plan: { plan_code: 'PLN_gold' }, customer: { customer_code: 'CUS_owner' }, next_payment_date: PERIOD_END.toISOString() });
    expect((await sub()).paystackSubscriptionCode).toBe('SUB_gold_v2');
    // Paystack then reports the old one (the app disabled it) as disabled.
    await webhook('subscription.disable', { subscription_code: 'SUB_gold', customer: { customer_code: 'CUS_owner' } });
    expect(await sub()).toMatchObject({ status: 'active', paystackSubscriptionCode: 'SUB_gold_v2' });
    expect((await sub()).cancelAtPeriodEnd ?? false).toBe(false);
  });

  it('after scheduling a downgrade: the Gold subscription\'s disable (the app\'s own) doesn\'t cancel the school', async () => {
    const res = await call('/api/billing/manage', { token: gold, body: { action: 'schedule_downgrade', tier: 'bronze' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(externalCalls.filter((c) => String(c.url).includes('/subscription/disable')).map((c) => c.body.code)).toContain('SUB_gold');
    await webhook('subscription.disable', { subscription_code: 'SUB_gold', customer: { customer_code: 'CUS_owner' } });
    const s = await sub();
    expect(s.status).toBe('active');
    expect(s.cancelAtPeriodEnd ?? false).toBe(false);
    expect(s.scheduledTierChange).toMatchObject({ tier: 'bronze' });
  });
});
