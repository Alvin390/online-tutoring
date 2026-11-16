import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, fakes, resetFakes,
} from '../_worker.js';

/**
 * 010Fixes (owner, 2026-11-16, after the first class with admission numbers):
 *   02  one code at a time: within its 10 minutes the SAME code is sent again
 *       (a new one only when it expired, was used, is locked by wrong tries,
 *       has under 2 minutes left, or is of another kind);
 *   03  no silent lockout: 5 wrong tries say so, and the hourly cap says to
 *       ask the teacher;
 *   05  "out of date" pages are told to close and reopen the class link.
 */

const P = (n) => `+2547170${String(10000 + n).padStart(5, '0')}`;
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn(fakes.hashback.sent.at(-1)?.message);
let db; let sha256;
const otp = (phone) => db.collection('otp').doc(sha256(phone));
const later = (phone, extra = {}) => otp(phone).set({ sentAt: new Date(Date.now() - 61_000), ...extra }, { merge: true });
const ask = (phone, body = {}) => call('/api/student/requestCode', { body: { session: 'evening', phone, ...body } });
const verify = (phone, code, body = {}) => call('/api/student/verifyCode', { body: { session: 'evening', phone, code, ...body } });
const seed = (phone) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: 'Kid Name', parentPhone: phone, class: 'Form 3', session: 'evening', approvalStatus: 'approved', blocked: false,
});

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  ({ sha256 } = await import('../../../api/_lib/crypto.js'));
});
beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('one code at a time', () => {
  it('the same code, three times; every SMS works; it keeps its first expiry', async () => {
    await seed(P(1));
    await ask(P(1));
    const first = lastCode();
    const { expiresAt } = (await otp(P(1)).get()).data();
    for (let i = 0; i < 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await later(P(1));
      // eslint-disable-next-line no-await-in-loop
      expect((await ask(P(1))).status).toBe(200);
      expect(lastCode()).toBe(first);
    }
    expect(fakes.hashback.sent).toHaveLength(3);
    expect((await otp(P(1)).get()).data().expiresAt.toMillis()).toBe(expiresAt.toMillis());
    expect((await verify(P(1), first)).status).toBe(200);
  });

  it('a new code when the old one was used, expired, locked, or has under 2 minutes left', async () => {
    const fresh = async (phone, change) => {
      await seed(phone);
      await ask(phone);
      const old = (await otp(phone).get()).data().codeHash;
      await later(phone, change);
      expect((await ask(phone)).status).toBe(200);
      return (await otp(phone).get()).data().codeHash !== old;
    };
    expect(await fresh(P(2), { expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(await fresh(P(3), { expiresAt: new Date(Date.now() + 90_000) })).toBe(true);
    expect(await fresh(P(4), { attempts: 5 })).toBe(true);
    expect(await fresh(P(5), { consumedAt: new Date() })).toBe(true);
  });

  it('a code of another kind is never reused (a registration code, then a move code)', async () => {
    await ask(P(6), { purpose: 'register' });
    const old = (await otp(P(6)).get()).data().codeHash;
    await seed(P(7));
    await later(P(6));
    const moved = await call('/api/student/fixNumber', { body: { action: 'request', session: 'evening', oldPhone: P(7), newPhone: P(6) } });
    expect(moved.status).toBe(200);
    const now = (await otp(P(6)).get()).data();
    expect(now.codeHash).not.toBe(old);
    expect(now.purpose).toBe('move');
  });
});

describe('no silent lockout', () => {
  it('after 5 wrong tries: "too many tries" (not "not valid"); a new code then works', async () => {
    await seed(P(10));
    await ask(P(10));
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await verify(P(10), wrong)).body.error.code).toBe('invalid_code');
    }
    const locked = await verify(P(10), right);
    expect(locked.status).toBe(400);
    expect(locked.body.error.code).toBe('too_many_tries');
    expect(locked.body.error.message).toBe('Too many wrong tries. Tap Send again for a new code, or ask your teacher to read you your code.');
    await later(P(10));
    await ask(P(10));
    expect((await verify(P(10), lastCode())).status).toBe(200);
  });

  it('the hourly cap for one number says to ask the teacher', async () => {
    await seed(P(11));
    let res;
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await later(P(11), { consumedAt: new Date() }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      res = await ask(P(11));
    }
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_codes');
    expect(res.body.error.message).toBe('Too many codes for this number this hour. Ask your teacher to read you your code.');
  });
});

describe('"out of date" pages', () => {
  it('check-in and registration from an old page: close it and open the class link again', async () => {
    await seed(P(20));
    const checkin = await call('/api/student/checkin', { body: { session: 'evening', phone: P(20) } });
    expect(checkin.body.error.code).toBe('refresh_needed');
    expect(checkin.body.error.message).toBe('This page is out of date. Close it, then open the class link again and check in.');
    const register = await call('/api/student/register', {
      body: { session: 'evening', phone: P(21), studentName: 'New Kid', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: 'Paid by M-Pesa QWE123ABC' },
    });
    expect(register.body.error.code).toBe('refresh_needed');
    expect(register.body.error.message).toBe('This page is out of date. Close it, then open the class link again and register.');
  });

  it('the student-page settings are reused for at most a minute (switches take effect sooner)', async () => {
    const res = await call('/api/public/bootstrap', { method: 'GET' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, stale-while-revalidate=30');
  });
});
