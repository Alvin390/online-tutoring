import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  externalCalls, drainWaitUntil,
} from '../_worker.js';

/**
 * 013Fixes / 33a — the payments switch (owner answer 4): Paystack live/test
 * from Superadmin → Settings, in config/mode, with the environment
 * (PAYSTACK_MODE) as the fallback. The M-Pesa STK has its own Off/Demo/Live
 * setting (013Fixes / 30b), so this switch is Paystack only.
 *
 *   - the switch decides the Paystack keys and plans used;
 *   - to live only with live keys present; to test during a paid period only
 *     after typing "TEST";
 *   - a webhook signed for the OTHER mode is refused (409, audited) and never
 *     processed — Paystack retries, so a live payment that reaches an isolate
 *     still on the old mode is not lost;
 *   - the bootstrap says when payments are on test (the teachers' banner);
 *   - audited; superadmin only.
 */

const D = 86_400_000;
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-modes-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-modes-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/planPrices.js')).__resetPlanPrices();
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await setFlags(db, { 'billing.enabled': true });
  // A gifted school (no paid period), as production.
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: true, renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 300 * D) });
});

const modes = (body, token = admin) => call('/api/admin/modes', { token, body });
const initialize = () => call('/api/billing/initialize', { token: teacher, body: { tier: 'gold', channel: 'card' } });
const lastPaystack = () => externalCalls.filter((c) => String(c.url).startsWith('https://api.paystack.co')).pop();
const authOf = (c) => c?.headers?.Authorization ?? c?.headers?.authorization;
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());
const bootstrap = async () => (await call('/api/public/bootstrap', { method: 'GET' })).body;

let seq = 9100;
async function webhook(key, data = {}) {
  seq += 1;
  const raw = JSON.stringify({ id: seq, event: 'charge.success', data: { id: seq, reference: `r_${seq}`, amount: 1499900, channel: 'card', ...data } });
  const sig = createHmac('sha512', key).update(raw).digest('hex');
  return { res: await call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } }), id: String(seq) };
}

describe('the payments switch', () => {
  it('unset: the environment decides (PAYSTACK_MODE=test here); the card says so', async () => {
    const res = await modes({ action: 'status' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payments).toMatchObject({ mode: 'test', source: 'env', liveKeys: true });
    await initialize();
    expect(authOf(lastPaystack())).toBe('Bearer sk_test_harness_only');
  });

  it('live: the live keys are used, at once on this isolate; audited', async () => {
    const res = await modes({ action: 'setPayments', mode: 'live' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payments).toMatchObject({ mode: 'live', source: 'setting' });
    await initialize();
    expect(authOf(lastPaystack())).toBe('Bearer sk_live_harness_only');
    await drainWaitUntil();
    const [a] = await audits('mode.payments_changed');
    expect(a).toMatchObject({ before: { mode: 'test' }, after: { mode: 'live' } });
    expect(JSON.stringify(a)).not.toMatch(/sk_/);
  });

  it('back to test: the test keys again', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    const res = await modes({ action: 'setPayments', mode: 'test' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await initialize();
    expect(authOf(lastPaystack())).toBe('Bearer sk_test_harness_only');
  });

  it('live without live keys: refused, nothing changed', async () => {
    const saved = process.env.PAYSTACK_SECRET_KEY_LIVE;
    delete process.env.PAYSTACK_SECRET_KEY_LIVE;
    try {
      const res = await modes({ action: 'setPayments', mode: 'live' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('no_live_keys');
      expect((await db.doc('config/mode').get()).exists).toBe(false);
    } finally {
      process.env.PAYSTACK_SECRET_KEY_LIVE = saved;
    }
  });

  it('to test during a paid period: only after typing TEST', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: false, renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 20 * D) });
    (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
    let res = await modes({ action: 'setPayments', mode: 'test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('confirm_required');
    res = await modes({ action: 'setPayments', mode: 'test', confirm: 'test' });
    expect(res.status).toBe(409);
    res = await modes({ action: 'setPayments', mode: 'test', confirm: 'TEST' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.payments.mode).toBe('test');
  });

  it('superadmin only', async () => {
    expect((await modes({ action: 'status' }, teacher)).status).toBe(403);
    expect((await modes({ action: 'setPayments', mode: 'live' }, teacher)).status).toBe(403);
    expect((await call('/api/admin/modes', { body: { action: 'status' } })).status).toBe(401);
  });
});

describe('a webhook for the other mode is refused', () => {
  it('on test, an event signed with the LIVE key: 409 wrong_mode, audited, not processed', async () => {
    const { res, id } = await webhook(process.env.PAYSTACK_SECRET_KEY_LIVE, { domain: 'live' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('wrong_mode');
    expect((await db.doc(`billing/events/items/${id}`).get()).exists).toBe(false);
    await drainWaitUntil();
    const rejected = await audits('billing.webhook_rejected');
    expect(rejected.some((a) => a.context?.reason === 'wrong_mode')).toBe(true);
  });

  it('on live, an event signed with the TEST key: refused the same way', async () => {
    await modes({ action: 'setPayments', mode: 'live' });
    const { res, id } = await webhook(process.env.PAYSTACK_SECRET_KEY_TEST, { domain: 'test' });
    expect(res.status).toBe(409);
    expect((await db.doc(`billing/events/items/${id}`).get()).exists).toBe(false);
  });

  it('signed with the right key but the other domain: refused', async () => {
    const { res } = await webhook(process.env.PAYSTACK_SECRET_KEY_TEST, { domain: 'live' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('wrong_mode');
  });

  it('this mode\'s event: accepted as before', async () => {
    const { res, id } = await webhook(process.env.PAYSTACK_SECRET_KEY_TEST, { domain: 'test' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.doc(`billing/events/items/${id}`).get()).exists).toBe(true);
  });

  it('signed with neither key: 401 as before', async () => {
    const { res } = await webhook('sk_somebody_else', { domain: 'test' });
    expect(res.status).toBe(401);
  });
});

describe('the bootstrap tells the screens', () => {
  it('payments on test: paymentsTest true; on live: false', async () => {
    expect((await bootstrap()).modes).toMatchObject({ paymentsTest: true, smsFake: false });
    await modes({ action: 'setPayments', mode: 'live' });
    expect((await bootstrap()).modes).toMatchObject({ paymentsTest: false });
  });
});
