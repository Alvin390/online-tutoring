import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, resetFakes,
} from '../_worker.js';

/**
 * 013Fixes / 37 — the signed status link every school answers for the owner
 * console (owner suggestion 9). GET /api/platform/status, signed with the
 * shared CONSOLE_SECRET: HMAC-SHA256 over "METHOD\nhost\npath\ntimestamp"
 * (hex), in x-console-signature, with x-console-timestamp (ms). More than 5
 * minutes off either way → 401. No secret set → 404 (switched off).
 *
 * The reply is an allowlist of stored, school-level facts — never a student,
 * a phone, an email, a payment code or the maintenance message. It writes
 * nothing and answers during maintenance.
 *
 * The signature is computed HERE with node:crypto, not with the app's own
 * signing module, so a wrong algorithm or layout in the app is caught.
 */

const HOST = 'validation.example';
const PATH = '/api/platform/status';
const STUDENT = { name: 'Zuberi Testname', phone: '+254719300001' };
let db;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  await setFlags(db, { 'billing.enabled': true, 'fees.enabled': true, 'sms.enabled': true });
  await db.doc('config/smsSetup').set({ schoolName: 'Focus Academy', unlockedAt: new Date() });
  await db.doc('subscription/current').set({
    tier: 'gold', status: 'active', grantedBySuperadmin: false, renewalMode: 'manual', ownerUid: 'owner-uid-1',
    currentPeriodStart: new Date('2026-11-01T00:00:00Z'), currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    paystackCustomerCode: 'CUS_secret', paystackAuthorizationCode: 'AUTH_secret',
  });
  await db.doc('config/usage').set({
    activeStudents: 120, sessions: 2, logins: 3, limits: { activeStudents: 500, sessions: 5, logins: 10 },
    percent: { activeStudents: 24, sessions: 40, logins: 30 }, tier: 'gold', countedAtMs: Date.parse('2026-11-26T03:00:00Z'),
  });
  await db.doc('billing/payments/items/p1').set({
    createdAt: new Date('2026-11-01T09:00:00Z'), amountKes: 14999, method: 'mpesa', tier: 'gold',
    code: 'QAB123XYZ9', note: 'paid by the owner@school.example', reference: 'ref_1',
  });
  await db.doc(`sessions/evening/students/${STUDENT.phone}`).set({ studentName: STUDENT.name, parentPhone: STUDENT.phone, session: 'evening' });
  await db.doc('config/mode').set({ maintenance: { on: true, message: 'Call 0712000000 for help', until: new Date('2026-12-01T09:00:00Z') } });
});

const sign = ({ ts = Date.now(), method = 'GET', host = HOST, path = PATH, secret = process.env.CONSOLE_SECRET } = {}) => ({
  'x-console-timestamp': String(ts),
  'x-console-signature': createHmac('sha256', secret).update(`${method}\n${host}\n${path}\n${ts}`).digest('hex'),
});
const status = (headers = sign()) => call(PATH, { method: 'GET', headers });

describe('who may ask', () => {
  it('no signature, a wrong one, another host or path: 401', async () => {
    expect((await status({})).status).toBe(401);
    expect((await status(sign({ secret: 'not-the-secret' }))).status).toBe(401);
    expect((await status(sign({ host: 'other-school.example' }))).status).toBe(401);
    expect((await status(sign({ path: '/api/other' }))).status).toBe(401);
    expect((await status({ ...sign(), 'x-console-signature': 'ab'.repeat(32) })).status).toBe(401);
  });

  it('more than 5 minutes old or ahead: 401; within: 200', async () => {
    expect((await status(sign({ ts: Date.now() - 6 * 60_000 }))).status).toBe(401);
    expect((await status(sign({ ts: Date.now() + 6 * 60_000 }))).status).toBe(401);
    expect((await status(sign({ ts: Date.now() - 4 * 60_000 }))).status).toBe(200);
  });

  it('no CONSOLE_SECRET on this school: 404, saying nothing', async () => {
    const saved = process.env.CONSOLE_SECRET;
    delete process.env.CONSOLE_SECRET;
    try {
      const res = await status(sign({ secret: saved }));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/console|secret/i);
    } finally {
      process.env.CONSOLE_SECRET = saved;
    }
  });
});

describe('what it says', () => {
  it('the school-level facts, and nothing else', async () => {
    const res = await status();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body;
    expect(Object.keys(b).sort()).toEqual(['checkedAt', 'lastPayment', 'modes', 'mpesa', 'plan', 'school', 'sms', 'usage', 'version']);
    expect(b.school).toEqual({ name: 'Focus Academy' });
    expect(b.plan).toMatchObject({ tier: 'gold', status: 'active', comp: false, renewalMode: 'manual' });
    expect(b.plan.currentPeriodEnd).toBe(Date.parse('2026-12-01T00:00:00Z'));
    expect(b.lastPayment).toEqual({ at: Date.parse('2026-11-01T09:00:00Z'), amountKes: 14999, method: 'mpesa', tier: 'gold' });
    expect(b.usage).toMatchObject({ activeStudents: 120, sessions: 2, logins: 3, limits: { activeStudents: 500 }, countedAt: Date.parse('2026-11-26T03:00:00Z') });
    expect(b.sms).toEqual(expect.objectContaining({ available: expect.any(Number), includedLeft: expect.any(Number), topup: expect.any(Number) }));
    expect(b.modes).toEqual({ payments: 'test', sms: 'real', maintenance: { on: true, until: Date.parse('2026-12-01T09:00:00Z') }, demo: false });
    expect(b.mpesa).toEqual({ mode: 'off' });
    expect(b.version).toBeNull(); // no version binding in tests
  });

  it('no personal data, no payment codes, no maintenance text', async () => {
    const text = JSON.stringify((await status()).body);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\+?254\d{6,}|07\d{8}/);
    expect(text).not.toMatch(new RegExp(STUDENT.name));
    for (const s of ['QAB123XYZ9', 'ref_1', 'CUS_secret', 'AUTH_secret', 'owner-uid-1', 'Call 0712']) expect(text).not.toContain(s);
  });

  it('answers during maintenance, and writes nothing', async () => {
    const before = (await db.doc('config/usage').get()).data();
    expect((await status()).status).toBe(200);
    expect((await db.doc('config/usage').get()).data()).toEqual(before);
    expect((await db.doc('sms/credits').get()).exists).toBe(false);
  });
});
