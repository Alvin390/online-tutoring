import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
} from '../_worker.js';

/**
 * 013Fixes / 19 — superadmin "Start trial" (owner answer 6): a package, a
 * length (the billing setting by default) and, optionally, a payment
 * recorded with it (the pilot school pays half for her December trial). A
 * comp school becomes a trial; a running paid period is refused (Change plan
 * is for that); the same M-Pesa code can't be recorded twice. Audited.
 */

const D = 86_400_000;
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-trial-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-trial-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
});

const startTrial = (body, token = admin) => call('/api/admin/billing', { token, body: { action: 'startTrial', ...body } });
const sub = async () => (await db.doc('subscription/current').get()).data();
const payments = async () => (await db.collection('billing/payments/items').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ms = (t) => t?.toMillis?.() ?? null;

describe('starting a trial', () => {
  it('a package for the settings\' length; swept like any trial; audited', async () => {
    const before = Date.now();
    const res = await startTrial({ tier: 'gold' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ tier: 'gold', status: 'trialing', renewalMode: 'manual', grantedBySuperadmin: false, cancelAtPeriodEnd: false });
    expect(ms(s.trialEndsAt) - before).toBeGreaterThanOrEqual(14 * D - 5000);
    expect(ms(s.trialEndsAt) - before).toBeLessThanOrEqual(14 * D + 5000);
    expect(ms(s.currentPeriodEnd)).toBe(ms(s.trialEndsAt));
    expect(res.body).toMatchObject({ ok: true, tier: 'gold', days: 14 });
    const pub = (await db.doc('subscription/public').get()).data();
    expect(pub).toMatchObject({ status: 'trialing', endsAt: ms(s.trialEndsAt), countdownFrom: ms(s.trialEndsAt) - 48 * 3_600_000 });
    expect((await db.collection('audit').where('action', '==', 'billing.trial_started').get()).size).toBe(1);
    expect(await payments()).toEqual([]);
  });

  it('a chosen length', async () => {
    const before = Date.now();
    await startTrial({ tier: 'silver', days: 7 });
    expect(ms((await sub()).trialEndsAt) - before).toBeLessThanOrEqual(7 * D + 5000);
  });

  it('a comp school becomes a trial (the comp ends)', async () => {
    await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: true });
    expect((await startTrial({ tier: 'gold' })).status).toBe(200);
    expect(await sub()).toMatchObject({ status: 'trialing', grantedBySuperadmin: false });
  });
});

describe('with a payment recorded', () => {
  it('M-Pesa: recorded with its code, the trial\'s period and kind', async () => {
    const res = await startTrial({ tier: 'gold', payment: { amountKes: 2500, method: 'mpesa', code: 'qab1c2d3e4', note: 'Half of December' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    const [p] = await payments();
    expect(p).toMatchObject({
      id: 'mpesa_QAB1C2D3E4', amountKes: 2500, method: 'mpesa', code: 'QAB1C2D3E4', note: 'Half of December',
      kind: 'trial_payment', source: 'manual', tier: 'gold', actor: 'fx013-trial-admin',
    });
    expect(ms(p.periodFrom)).toBe(ms(s.currentPeriodStart));
    expect(ms(p.periodTo)).toBe(ms(s.trialEndsAt));
  });

  it('cash: no code needed', async () => {
    await startTrial({ tier: 'bronze', payment: { amountKes: 1000, method: 'cash' } });
    expect((await payments())[0]).toMatchObject({ method: 'cash', code: null, kind: 'trial_payment' });
  });

  it('the same M-Pesa code twice is refused, and nothing changes', async () => {
    await startTrial({ tier: 'gold', payment: { amountKes: 2500, method: 'mpesa', code: 'QAB1C2D3E4' } });
    const before = await sub();
    const again = await startTrial({ tier: 'silver', payment: { amountKes: 2500, method: 'mpesa', code: 'QAB1C2D3E4' } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('payment_code_used');
    expect((await sub()).tier).toBe(before.tier);
    expect(await payments()).toHaveLength(1);
  });

  it('M-Pesa needs its code; a bad amount is refused', async () => {
    expect((await startTrial({ tier: 'gold', payment: { amountKes: 2500, method: 'mpesa' } })).status).toBe(400);
    expect((await startTrial({ tier: 'gold', payment: { amountKes: 0, method: 'cash' } })).status).toBe(400);
    expect((await startTrial({ tier: 'gold', payment: { amountKes: 100, method: 'mpesa', code: 'short' } })).status).toBe(400);
  });
});

describe('refusals', () => {
  it('a paid period running: use Change plan instead', async () => {
    await db.doc('subscription/current').set({ tier: 'silver', status: 'active', renewalMode: 'manual', grantedBySuperadmin: false, currentPeriodEnd: new Date(Date.now() + 10 * D) });
    const res = await startTrial({ tier: 'gold' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('active_period');
    expect((await sub()).status).toBe('active');
  });

  it('superadmin only', async () => {
    expect((await startTrial({ tier: 'gold' }, teacher)).status).toBe(403);
  });
});
