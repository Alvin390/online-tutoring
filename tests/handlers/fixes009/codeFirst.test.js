import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, fakes, resetFakes,
} from '../_worker.js';

/**
 * 009Fixes / 01 — code-first registration (owner, 2026-11-16): with
 * admission numbers and `student.fixNumber` on, a new student confirms the
 * phone BEFORE the registration is saved, so a number that can't receive a
 * code can't register.
 *   requestCode { purpose: 'register' } — for a number with no record yet;
 *   verifyCode  { purpose: 'register' } — a ticket, no record needed;
 *   register    { ticket } — saved already confirmed.
 * Codes of the two kinds are not interchangeable. With the flag off,
 * registration is exactly as before (saved first, `next: 'verify'`).
 */

const P = (n) => `+2547161${String(10000 + n).padStart(5, '0')}`;
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn(fakes.hashback.sent.at(-1)?.message);
let db;

const form = (phone, extra = {}) => ({
  session: 'evening', phone, studentName: 'New Student', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'],
  receiptMessage: 'Paid by M-Pesa QWE123 for the class', number: '4071', ...extra,
});
const requestCode = (phone, purpose) => call('/api/student/requestCode', { body: { session: 'evening', phone, ...(purpose ? { purpose } : {}) } });
const verifyCode = (phone, code, purpose) => call('/api/student/verifyCode', { body: { session: 'evening', phone, code, ...(purpose ? { purpose } : {}) } });
const register = (body) => call('/api/student/register', { body });
const record = async (phone) => (await db.doc(`sessions/evening/students/${phone}`).get()).data() ?? null;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('code first', () => {
  it('code → ticket → registered, already confirmed, with the chosen number', async () => {
    const asked = await requestCode(P(1), 'register');
    expect(asked.status).toBe(200);
    expect(asked.body.deliveryChannel).toBe('sms');
    expect(fakes.hashback.sent.at(-1).to).toBe(P(1));
    expect(await record(P(1))).toBeNull(); // nothing saved yet

    const verified = await verifyCode(P(1), lastCode(), 'register');
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ ok: true, next: 'register' });
    expect(verified.body.ticket).toMatch(/^v1\./);
    expect(await record(P(1))).toBeNull();

    const res = await register({ ...form(P(1)), ticket: verified.body.ticket });
    expect(res.status).toBe(200);
    expect(res.body.next).toBe('checkin');
    const saved = await record(P(1));
    expect(saved.phoneVerifiedAt).toBeTruthy();
    expect(saved.admissionNumber).toBe('4071');
  });

  it('no ticket (an old page): told to refresh; a wrong or other-number ticket: confirm first; nothing saved', async () => {
    const old = await register(form(P(2)));
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe('refresh_needed');
    const bad = await register({ ...form(P(2)), ticket: 'v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('verify_first');
    await requestCode(P(3), 'register');
    const other = await verifyCode(P(3), lastCode(), 'register');
    const swapped = await register({ ...form(P(2)), ticket: other.body.ticket });
    expect(swapped.body.error.code).toBe('verify_first');
    expect(await record(P(2))).toBeNull();
  });

  it('a number already registered here: refused before any SMS', async () => {
    await requestCode(P(4), 'register');
    const t = await verifyCode(P(4), lastCode(), 'register');
    await register({ ...form(P(4)), ticket: t.body.ticket });
    const sentBefore = fakes.hashback.sent.length;
    const again = await requestCode(P(4), 'register');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_registered');
    expect(fakes.hashback.sent.length).toBe(sentBefore);
  });

  it('a number the teacher retired: refused before any SMS', async () => {
    await db.doc(`sessions/evening/retiredNumbers/${P(5)}`).set({ reason: 'merged', keptSuffix: '123' });
    const res = await requestCode(P(5), 'register');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('retired_number');
    expect(fakes.hashback.sent).toHaveLength(0);
  });

  it('the two kinds of code are not interchangeable', async () => {
    // A registration code cannot confirm an existing record...
    await requestCode(P(6), 'register');
    const regCode = lastCode();
    await db.doc(`sessions/evening/students/${P(6)}`).set({ studentName: 'X', parentPhone: P(6), class: 'Form 3', session: 'evening', approvalStatus: 'approved', blocked: false });
    expect((await verifyCode(P(6), regCode)).body.error.code).toBe('invalid_code');
    // ...and a record's code cannot be used to register.
    await db.doc(`otp/${(await import('../../../api/_lib/crypto.js')).sha256(P(6))}`).delete();
    await requestCode(P(6));
    const recCode = lastCode();
    expect((await verifyCode(P(6), recCode, 'register')).body.error.code).toBe('invalid_code');
  });

  it('register-kind codes from one address: 30 an hour, like registration itself', async () => {
    const statuses = [];
    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await call('/api/student/requestCode', { ip: '196.0.0.77', body: { session: 'evening', phone: P(100 + i), purpose: 'register' } })).status);
    }
    expect(statuses.slice(0, 30).every((st) => st === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('flag off: registration as before (saved first, then the code)', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': false });
    const res = await register(form(P(7)));
    expect(res.status).toBe(200);
    expect(res.body.next).toBe('verify');
    expect((await record(P(7))).phoneVerifiedAt).toBeUndefined();
    // 014Fixes / 00: one switch — the registration code follows
    // checkin.admissionNumbers alone, whatever student.fixNumber says.
    const reg = await requestCode(P(8), 'register');
    expect(reg.status).toBe(200);
    expect(fakes.hashback.sent).toHaveLength(1);
  });
});
