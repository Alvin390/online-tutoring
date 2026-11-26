import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, resetFakes,
  drainWaitUntil,
} from '../_worker.js';

/**
 * 013Fixes / 34 — maintenance mode (owner answer 4). The superadmin switches
 * it on, with an optional message and expected end time. While on:
 *   - students and teachers get 503 `maintenance` (with the message) from
 *     the API; the bootstrap carries it so the screens show "Under
 *     maintenance" without asking;
 *   - the superadmin keeps working (their page and any endpoint);
 *   - Paystack's webhook, Safaricom's callback, the crons, /api/health and
 *     the sign-in counter keep working.
 * Audited; superadmin only.
 */

const CRON = { authorization: `Bearer ${process.env.CRON_SECRET ?? 'test-cron-secret'}` };
const PHONE = '+254718200001';
const UNTIL = Date.parse('2026-12-01T09:00:00Z');
let db; let admin; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-maint-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-maint-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  resetFakes();
  await setFlags(db, { 'billing.enabled': true, 'fees.enabled': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active', grantedBySuperadmin: true, renewalMode: 'manual', currentPeriodEnd: new Date(Date.now() + 100 * 86_400_000) });
  await db.doc(`sessions/evening/students/${PHONE}`).set({
    studentName: 'Kid', parentPhone: PHONE, class: 'Form 3', subjects: 'English', session: 'evening',
    registeredAt: new Date(), blocked: false, approvalStatus: 'approved', feeBalance: 0,
  });
});

const modes = (body, token = admin) => call('/api/admin/modes', { token, body });
const on = () => modes({ action: 'setMaintenance', on: true, message: 'Upgrading the class links.', until: UNTIL });
const checkin = () => call('/api/student/checkin', { body: { session: 'evening', phone: PHONE } });
const teacherCall = (token = teacher) => call('/api/billing/status', { method: 'GET', token });
const expectMaintenance = (res) => {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.body.error.code).toBe('maintenance');
  expect(res.body.error.message).toMatch(/Upgrading the class links/);
};

describe('maintenance on', () => {
  it('the switch: on with a message and an end time, audited; the bootstrap carries it', async () => {
    const res = await on();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.maintenance).toMatchObject({ on: true, message: 'Upgrading the class links.', until: UNTIL });
    await drainWaitUntil();
    const [a] = (await db.collection('audit').where('action', '==', 'mode.maintenance_changed').get()).docs.map((d) => d.data());
    expect(a).toMatchObject({ after: { on: true } });
    const boot = await call('/api/public/bootstrap', { method: 'GET' });
    expect(boot.status).toBe(200);
    expect(boot.body.modes.maintenance).toEqual({ message: 'Upgrading the class links.', until: UNTIL });
  });

  it('students and teachers: 503 maintenance, with the message', async () => {
    await on();
    expectMaintenance(await checkin());
    expectMaintenance(await teacherCall());
  });

  it('the superadmin keeps working, on any endpoint', async () => {
    await on();
    expect((await modes({ action: 'status' })).status).toBe(200);
    expect((await teacherCall(admin)).status).toBe(200);
  });

  it('webhooks, crons, health and the sign-in counter keep working', async () => {
    const before = await call('/api/daraja/callback/abcdefghijklmnopqrstuv', { ip: '196.201.214.200', body: { Body: { stkCallback: { CheckoutRequestID: 'none', ResultCode: 1 } } } });
    await on();
    expect((await call('/api/health', { method: 'GET' })).status).toBe(200);
    expect((await call('/api/cron/subscriptionSweep', { headers: CRON, body: {} })).status).toBe(200);
    expect((await call('/api/cron/feesSweep', { headers: CRON, body: {} })).status).toBe(200);
    expect((await call('/api/auth/loginAttempt', { body: { email: 'someone@school.example', outcome: 'check' } })).status).not.toBe(503);
    const raw = JSON.stringify({ id: 88001, event: 'charge.success', data: { id: 88001, reference: 'maint_r1', amount: 100, channel: 'card', domain: 'test' } });
    const sig = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY_TEST).update(raw).digest('hex');
    expect((await call('/api/billing/webhook', { body: raw, headers: { 'x-paystack-signature': sig } })).status).toBe(200);
    const after = await call('/api/daraja/callback/abcdefghijklmnopqrstuv', { ip: '196.201.214.200', body: { Body: { stkCallback: { CheckoutRequestID: 'none', ResultCode: 1 } } } });
    expect(after.status).toBe(before.status);
  });

  it('off again: everyone back; the bootstrap says no maintenance', async () => {
    await on();
    const res = await modes({ action: 'setMaintenance', on: false });
    expect(res.status).toBe(200);
    expect((await checkin()).status).not.toBe(503);
    expect((await teacherCall()).status).toBe(200);
    expect((await call('/api/public/bootstrap', { method: 'GET' })).body.modes.maintenance).toBeNull();
  });

  it('no message: a plain one', async () => {
    await modes({ action: 'setMaintenance', on: true });
    const res = await checkin();
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/under maintenance/i);
  });

  it('superadmin only', async () => {
    expect((await modes({ action: 'setMaintenance', on: true }, teacher)).status).toBe(403);
  });
});
