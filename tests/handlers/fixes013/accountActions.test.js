import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
} from '../_worker.js';

/**
 * 013Fixes / 22 — the superadmin's account actions (owner suggestions 2, 3,
 * 4 and 8), each audited and superadmin only:
 *   changePlan, extend by N days, lock now, unlock until a date;
 *   private notes on the school (with their history), never a teacher's;
 *   per-school overrides of the plan's limits and features.
 * Gift (comp) and Cancel reuse /api/billing/manage (grant, cancel).
 */

const D = 86_400_000;
let db; let admin; let teacher; let resolveSubscriptionState;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-acct-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-acct-teacher', teacherClaims.gold);
  ({ resolveSubscriptionState } = await import('../../../api/_lib/subscription.js'));
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  (await import('../../../api/_lib/schoolPlan.js')).__resetPlanCache();
  (await import('../../../api/_lib/billingSettings.js')).__resetBillingSettingsCache();
  await setFlags(db, { 'billing.enabled': true });
});

const act = (action, extra = {}, token = admin) => call('/api/admin/billing', { token, body: { action, ...extra } });
const setSub = (data) => db.doc('subscription/current').set(data);
const sub = async () => (await db.doc('subscription/current').get()).data();
const pub = async () => (await db.doc('subscription/public').get()).data();
const ms = (t) => t?.toMillis?.() ?? null;
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());
const status = () => call('/api/billing/status', { method: 'GET', token: teacher });

describe('Change plan', () => {
  it('takes effect now, clears a queued package, keeps the period; audited', async () => {
    const end = Date.now() + 10 * D;
    await setSub({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(end), nextTier: 'silver', nextPeriodStart: new Date(end - D) });
    const res = await act('changePlan', { tier: 'bronze' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ tier: 'bronze', status: 'active', nextTier: null });
    expect(ms(s.currentPeriodEnd)).toBe(end);
    expect((await pub()).tier).toBe('bronze');
    expect((await status()).body.plan.tier).toBe('bronze');
    expect((await audits('billing.plan_changed'))[0]).toMatchObject({ before: { tier: 'gold' }, after: { tier: 'bronze' } });
  });

  it('a gifted school stays gifted', async () => {
    await setSub({ tier: 'gold', status: 'active', grantedBySuperadmin: true, currentPeriodEnd: new Date(Date.now() + 300 * D) });
    await act('changePlan', { tier: 'silver' });
    expect(await sub()).toMatchObject({ tier: 'silver', grantedBySuperadmin: true });
  });

  it('refused for a school paying by card (Paystack would bill the old plan)', async () => {
    await setSub({ tier: 'gold', status: 'active', renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x', currentPeriodEnd: new Date(Date.now() + D) });
    expect((await act('changePlan', { tier: 'silver' })).body.error.code).toBe('card_active');
  });
});

describe('Extend by N days', () => {
  it('a trial: its end moves, with the period and a queued month; reminders start again', async () => {
    const trialEnd = Date.now() + 2 * D;
    const queuedEnd = trialEnd + 31 * D;
    await setSub({ tier: 'gold', status: 'trialing', renewalMode: 'manual', currentPeriodStart: new Date(trialEnd - 14 * D), trialEndsAt: new Date(trialEnd), currentPeriodEnd: new Date(queuedEnd), nextPeriodStart: new Date(trialEnd), remindersSent: ['days_3'] });
    const res = await act('extend', { days: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    expect(ms(s.trialEndsAt)).toBe(trialEnd + 5 * D);
    expect(ms(s.nextPeriodStart)).toBe(trialEnd + 5 * D);
    expect(ms(s.currentPeriodEnd)).toBe(queuedEnd + 5 * D);
    expect(ms(s.currentPeriodStart)).toBe(trialEnd - 14 * D); // never a fresh SMS window
    expect(s.remindersSent).toEqual([]);
    expect((await pub()).endsAt).toBe(queuedEnd + 5 * D);
    expect((await audits('billing.extended'))[0].after).toMatchObject({ days: 5 });
  });

  it('an active period: its end moves', async () => {
    const end = Date.now() + 3 * D;
    await setSub({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(end) });
    await act('extend', { days: 10 });
    expect(ms((await sub()).currentPeriodEnd)).toBe(end + 10 * D);
  });

  it('refused: locked (use Unlock), gifted (no end), card (the next charge would undo it)', async () => {
    await setSub({ tier: 'silver', status: 'locked', currentPeriodEnd: new Date(Date.now() - D) });
    expect((await act('extend', { days: 3 })).body.error.code).toBe('not_running');
    await setSub({ tier: 'gold', status: 'active', grantedBySuperadmin: true });
    expect((await act('extend', { days: 3 })).body.error.code).toBe('comp');
    await setSub({ tier: 'gold', status: 'active', renewalMode: 'auto', paystackSubscriptionCode: 'SUB_x', currentPeriodEnd: new Date(Date.now() + D) });
    expect((await act('extend', { days: 3 })).body.error.code).toBe('card_active');
    expect((await act('extend', { days: 0 })).status).toBe(400);
  });
});

describe('Lock now and Unlock until', () => {
  it('lock: locked at once; audited', async () => {
    await setSub({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 10 * D) });
    expect((await act('lock')).status).toBe(200);
    expect(await sub()).toMatchObject({ status: 'locked', lockedBySuperadmin: true });
    expect((await pub()).status).toBe('locked');
    expect((await status()).body.accessGranted).toBe(false);
    expect(await audits('billing.locked')).toHaveLength(1);
  });

  it('a gifted school locked and unlocked until a date locks again at that date (the gift ends)', async () => {
    const start = Date.now() - 40 * D;
    await setSub({ tier: 'gold', status: 'active', grantedBySuperadmin: true, currentPeriodStart: new Date(start), currentPeriodEnd: new Date(Date.now() + 300 * D) });
    await act('lock');
    expect((await sub()).grantedBySuperadmin).toBe(false);
    const until = Date.now() + 3 * D;
    const res = await act('unlock', { until });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await sub();
    expect(s).toMatchObject({ status: 'active', grantedBySuperadmin: false, lockedBySuperadmin: false, renewalMode: 'manual' });
    expect(ms(s.currentPeriodEnd)).toBe(until);
    expect(ms(s.currentPeriodStart)).toBe(start);
    expect(resolveSubscriptionState(s, until + 1000).status).toBe('locked');
    expect(await audits('billing.unlocked')).toHaveLength(1);
  });

  it('unlock never opens a fresh SMS window (the period start is kept)', async () => {
    const start = Date.now() - 45 * D;
    await setSub({ tier: 'silver', status: 'locked', renewalMode: 'manual', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(Date.now() - 15 * D) });
    await act('unlock', { until: Date.now() + 2 * D });
    expect(ms((await sub()).currentPeriodStart)).toBe(start);
  });

  it('a locked school with a paid month queued opens until that month begins (the date is not used)', async () => {
    const next = Date.now() + 4 * D;
    const queuedEnd = next + 31 * D;
    await setSub({ tier: 'silver', status: 'locked', renewalMode: 'manual', currentPeriodEnd: new Date(queuedEnd), nextPeriodStart: new Date(next), nextTier: 'gold' });
    const res = await act('unlock', { until: Date.now() + 2 * D });
    expect(res.body).toMatchObject({ ok: true, until: next, queued: true });
    const s = await sub();
    expect(s).toMatchObject({ status: 'active', nextTier: 'gold' });
    expect(ms(s.nextPeriodStart)).toBe(next);
    expect(ms(s.currentPeriodEnd)).toBe(queuedEnd);
  });

  it('refused: not locked; a date in the past or over a year away', async () => {
    await setSub({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + D) });
    expect((await act('unlock', { until: Date.now() + D })).body.error.code).toBe('not_locked');
    await setSub({ tier: 'silver', status: 'locked' });
    expect((await act('unlock', { until: Date.now() - 1000 })).status).toBe(400);
    expect((await act('unlock', { until: Date.now() + 400 * D })).status).toBe(400);
  });
});

describe('notes on the school', () => {
  it('saved with their history; audited without the text', async () => {
    expect((await act('notes')).body).toEqual({ notes: null, history: [] });
    await act('saveNotes', { contact: 'Placeholder Person, 0700 000 000', agreedPrice: 'KES 2,000 a month', promises: '' });
    await act('saveNotes', { contact: 'Placeholder Person, 0700 000 000', agreedPrice: 'KES 2,500 a month', promises: 'A free week in April' });
    const res = await act('notes');
    expect(res.body.notes).toMatchObject({ contact: 'Placeholder Person, 0700 000 000', agreedPrice: 'KES 2,500 a month', promises: 'A free week in April', updatedBy: 'fx013-acct-admin' });
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0]).toMatchObject({ actor: 'fx013-acct-admin', before: { agreedPrice: 'KES 2,000 a month' }, after: { agreedPrice: 'KES 2,500 a month' } });
    const [audit] = await audits('billing.notes_changed');
    expect(JSON.stringify(audit)).not.toMatch(/Placeholder|KES 2|April/);
  });

  it('never a teacher\'s', async () => {
    await act('saveNotes', { contact: 'x', agreedPrice: 'y', promises: 'z' });
    expect((await act('notes', {}, teacher)).status).toBe(403);
    expect((await act('saveNotes', { contact: 'x' }, teacher)).status).toBe(403);
    expect(JSON.stringify((await status()).body)).not.toMatch(/agreedPrice/);
  });
});

describe('per-school overrides', () => {
  beforeEach(async () => {
    await setSub({ tier: 'bronze', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 10 * D) });
  });

  it('a limit and a feature change the plan everywhere; "custom" shows; clearing restores the plan', async () => {
    const plain = (await status()).body.plan;
    expect(plain.custom).toBe(false);
    const res = await act('saveOverrides', { limits: { logins: 7, smsUnits: 900 }, features: { fees: false, mpesaStk: true } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const custom = (await status()).body.plan;
    expect(custom).toMatchObject({ custom: true, tier: 'bronze' });
    expect(custom.limits).toMatchObject({ logins: 7, smsUnits: 900, activeStudents: plain.limits.activeStudents });
    expect(custom.features).toMatchObject({ fees: false, mpesaStk: true });
    expect((await audits('billing.overrides_changed'))[0].after).toEqual({ limits: { logins: 7, smsUnits: 900 }, features: { fees: false, mpesaStk: true } });

    // Removing one key removes it (the map is replaced, not merged).
    await act('saveOverrides', { limits: { logins: 7 }, features: {} });
    const partial = (await status()).body.plan;
    expect(partial.limits.smsUnits).toBe(plain.limits.smsUnits);
    expect(partial.features.fees).toBe(plain.features.fees);
    expect(partial.limits.logins).toBe(7);

    await act('saveOverrides', { limits: {}, features: {} });
    const back = (await status()).body.plan;
    expect(back.custom).toBe(false);
    expect(back.limits).toEqual(plain.limits);
    expect((await sub()).schoolOverrides ?? null).toBeNull();
  });

  it('an override gates the server (a feature switched off is refused)', async () => {
    await setSub({ tier: 'gold', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 10 * D) });
    const { requireFeature, __resetPlanCache } = await import('../../../api/_lib/schoolPlan.js');
    await expect(requireFeature({ role: 'teacher' }, 'fees', db)).resolves.toBeTruthy();
    await act('saveOverrides', { limits: {}, features: { fees: false } });
    __resetPlanCache();
    await expect(requireFeature({ role: 'teacher' }, 'fees', db)).rejects.toMatchObject({ status: 403 });
  });

  it('unknown keys and bad values are refused; superadmin only', async () => {
    expect((await act('saveOverrides', { limits: { seats: 3 }, features: {} })).status).toBe(400);
    expect((await act('saveOverrides', { limits: { logins: -1 }, features: {} })).status).toBe(400);
    expect((await act('saveOverrides', { limits: {}, features: { fees: 'yes' } })).status).toBe(400);
    expect((await act('saveOverrides', { limits: {}, features: {} }, teacher)).status).toBe(403);
  });
});

describe('superadmin only', () => {
  it('every action', async () => {
    await setSub({ tier: 'silver', status: 'active', renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + D) });
    for (const [action, extra] of [['changePlan', { tier: 'gold' }], ['extend', { days: 1 }], ['lock', {}], ['unlock', { until: Date.now() + D }]]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await act(action, extra, teacher)).status).toBe(403);
    }
  });
});
