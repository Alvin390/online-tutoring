import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims, resetFakes, fakes,
} from '../_worker.js';

/**
 * 008Fixes / 03 — check-in by admission number + phone, one device per class.
 * Every outcome in plan/phase-03 in order, the class link following the same
 * lock, registration with a number, and the flag off = today exactly.
 */

const P = (n) => `+2547152${String(10000 + n).padStart(5, '0')}`;
const DEV_A = 'deviceAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEV_B = 'deviceBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
let db; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx008-checkin-teacher', teacherClaims.gold);
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
/** A verified record holding `number` (admission, or staff with staff: true). */
const seedNumbered = async (session, phone, number, extra = {}) => {
  const staff = extra.staff === true;
  await seed(session, phone, { phoneVerifiedAt: new Date(), [staff ? 'staffNumber' : 'admissionNumber']: number, ...extra });
  await db.doc(`sessions/${session}/numbers/${staff ? 'S' : 'A'}${number}`).set({ phone, kind: staff ? 'staff' : 'student', number });
};
const checkin = (body, opts = {}) => call('/api/student/checkin', { body: { session: 'evening', deviceId: DEV_A, ...body }, ...opts });
const link = (body) => call('/api/class/link', { body: { session: 'evening', deviceId: DEV_A, ...body } });
const lock = async (s, p) => (await db.doc(`sessions/${s}/students/${p}/meta/checkinLock`).get()).data() ?? null;

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
  await db.doc('sessions/evening/private/classLink').set({ url: 'https://zoom.us/j/123456789', provider: 'zoom' });
});

describe('the outcomes, in order', () => {
  it('no record: as today', async () => {
    const res = await checkin({ phone: P(1) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false, student: null });
  });

  it('a page from before admission numbers (no device id) is told to refresh', async () => {
    await seedNumbered('evening', P(2), '4071');
    const res = await call('/api/student/checkin', { body: { session: 'evening', phone: P(2) } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('refresh_needed');
    expect(res.body.error.message).toMatch(/out of date. Close it, then open the class link again/); // 010Fixes / 05
  });

  it('not confirmed yet → verify (no student data, no pass)', async () => {
    await seed('evening', P(3));
    const res = await checkin({ phone: P(3) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('verify_required');
    expect(JSON.stringify(res.body)).not.toMatch(/Student|pass/);
  });

  it('confirmed without a number → choose one (staff: a staff number)', async () => {
    await seed('evening', P(4), { phoneVerifiedAt: new Date() });
    const res = await checkin({ phone: P(4) });
    expect(res.body.error.code).toBe('choose_number');
    expect(res.body.error.message).toMatch(/admission number/);
    await seed('evening', P(5), { phoneVerifiedAt: new Date(), staff: true });
    expect((await checkin({ phone: P(5) })).body.error.message).toMatch(/staff number/);
  });

  it('has a number: the phone alone is refused', async () => {
    await seedNumbered('evening', P(6), '4071');
    const res = await checkin({ phone: P(6) });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'number_required', message: 'Enter your admission number too.' });
  });

  it('a wrong number gets the neutral message — the same for a wrong phone', async () => {
    await seedNumbered('evening', P(7), '4071');
    await seedNumbered('evening', P(8), '5820');
    const wrongNumber = await checkin({ phone: P(7), number: '5820' });
    expect(wrongNumber.status).toBe(403);
    expect(wrongNumber.body.error.code).toBe('number_mismatch');
    const wrongPhone = await checkin({ phone: P(8), number: '4071' });
    expect(wrongPhone.body.error).toEqual(wrongNumber.body.error);
    const garbage = await checkin({ phone: P(7), number: '40' });
    expect(garbage.status).toBe(400);
    expect(garbage.body.error.code).toBe('invalid_number');
  });

  it('two records claiming one number → the teacher sorts out duplicates', async () => {
    await seedNumbered('evening', P(9), '4071');
    // A second record says it holds 4071, but the reservation names P(9).
    await seed('evening', P(10), { phoneVerifiedAt: new Date(), admissionNumber: '4071' });
    const res = await checkin({ phone: P(10), number: '4071' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('duplicate_records');
    expect(res.body.error.message).toMatch(/teacher needs to sort out duplicate records/);
  });

  it('both match → in, as today (projection and pass), and the lock is taken', async () => {
    await seedNumbered('evening', P(11), '4071');
    const res = await checkin({ phone: P(11), number: '4071' });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.student).toMatchObject({ studentName: `Student ${P(11).slice(-3)}`, approvalStatus: 'approved' });
    expect(res.body.pass).toMatch(/^v1\./);
    // The number itself is never projected.
    expect(JSON.stringify(res.body.student)).not.toContain('4071');
    const l = await lock('evening', P(11));
    expect(l.deviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(l.until.toMillis()).toBeGreaterThan(Date.now());
  });

  it('staff check in with S- and their phone; S-4071 is not admission 4071', async () => {
    await seedNumbered('evening', P(12), '4071', { staff: true });
    for (const typed of ['S-4071', 's4071', 'S 4071']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await checkin({ phone: P(12), number: typed })).status, typed).toBe(200);
    }
    expect((await checkin({ phone: P(12), number: '4071' })).body.error.code).toBe('number_mismatch');
    await seedNumbered('evening', P(13), '5820');
    expect((await checkin({ phone: P(13), number: 'S-5820' })).body.error.code).toBe('number_mismatch');
  });
});

describe('one device per class', () => {
  it('the same device repeats freely; another device is refused; "Allow again" lets it switch', async () => {
    await seedNumbered('evening', P(20), '4071');
    expect((await checkin({ phone: P(20), number: '4071' })).status).toBe(200);
    const firstLock = await lock('evening', P(20));
    expect((await checkin({ phone: P(20), number: '4071' })).status).toBe(200);
    // Written once per class, not per visit.
    expect((await lock('evening', P(20))).at.toMillis()).toBe(firstLock.at.toMillis());

    const other = await checkin({ phone: P(20), number: '4071', deviceId: DEV_B });
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('other_device');
    expect(other.body.error.message).toMatch(/already checked in on another device/);

    const allow = await call('/api/students/admission', { token: teacher, body: { action: 'allowAgain', session: 'evening', phone: P(20) } });
    expect(allow.status).toBe(200);
    expect((await checkin({ phone: P(20), number: '4071', deviceId: DEV_B })).status).toBe(200);
    // Now device A is the other one.
    expect((await checkin({ phone: P(20), number: '4071' })).body.error.code).toBe('other_device');
  });

  it('an expired lock is replaced', async () => {
    await seedNumbered('evening', P(21), '4071');
    await checkin({ phone: P(21), number: '4071' });
    await db.doc(`sessions/evening/students/${P(21)}/meta/checkinLock`).set({ until: new Date(Date.now() - 1000) }, { merge: true });
    expect((await checkin({ phone: P(21), number: '4071', deviceId: DEV_B })).status).toBe(200);
  });

  it('two devices at the same instant: one gets in', async () => {
    await seedNumbered('evening', P(22), '4071');
    const [a, b] = await Promise.all([
      checkin({ phone: P(22), number: '4071' }),
      checkin({ phone: P(22), number: '4071', deviceId: DEV_B }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
  });

  it('the class link: only the device holding the lock; phone-only or another device is refused', async () => {
    await seedNumbered('evening', P(23), '4071');
    expect((await link({ phone: P(23) })).body.error.code).toBe('checkin_again');
    await checkin({ phone: P(23), number: '4071' });
    const ok = await link({ phone: P(23) });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toBe('https://zoom.us/j/123456789');
    expect((await link({ phone: P(23), deviceId: DEV_B })).body.error.code).toBe('checkin_again');
    expect((await call('/api/class/link', { body: { session: 'evening', phone: P(23) } })).body.error.code).toBe('checkin_again');
  });

  it('"Allow again" is the teacher\'s only', async () => {
    await seedNumbered('evening', P(24), '4071');
    expect((await call('/api/students/admission', { body: { action: 'allowAgain', session: 'evening', phone: P(24) } })).status).toBe(401);
  });
});

describe('the lock lasts until the class ends', () => {
  it('lockUntil: today\'s class end while it runs or is ahead; midnight after it or with no class time', async () => {
    const { lockUntil, nextMidnightNairobi } = await import('../../../api/_lib/checkinLock.js');
    // Tuesday 2026-11-17, Nairobi = UTC+3.
    const at = (hhmm) => Date.parse(`2026-11-17T${hhmm}:00+03:00`);
    const schedule = { days: [], startTime: '17:00', endTime: '19:00', tz: 'Africa/Nairobi' };
    const classEnd = at('19:00');
    const midnight = Date.parse('2026-11-18T00:00:00+03:00');
    expect(nextMidnightNairobi(at('10:00'))).toBe(midnight);
    expect(lockUntil(schedule, at('16:30'))).toBe(classEnd); // early arrival
    expect(lockUntil(schedule, at('18:00'))).toBe(classEnd); // mid-class
    expect(lockUntil(schedule, at('19:30'))).toBe(midnight); // after class
    expect(lockUntil(null, at('09:00'))).toBe(midnight); // no class time
    // A class only on Mondays: on Tuesday, midnight.
    expect(lockUntil({ ...schedule, days: [1] }, at('18:00'))).toBe(midnight);
    // Past midnight: 22:00–01:00, checked in at 23:30 and at 00:30.
    const late = { days: [], startTime: '22:00', endTime: '01:00', tz: 'Africa/Nairobi' };
    expect(lockUntil(late, at('23:30'))).toBe(Date.parse('2026-11-18T01:00:00+03:00'));
    expect(lockUntil(late, Date.parse('2026-11-18T00:30:00+03:00'))).toBe(Date.parse('2026-11-18T01:00:00+03:00'));
  });

  it('a check-in stores the session schedule\'s end', async () => {
    const { lockUntil } = await import('../../../api/_lib/checkinLock.js');
    const schedule = { days: [], startTime: '06:00', endTime: '23:59', tz: 'Africa/Nairobi' };
    await db.doc('sessions/evening').set({ schedule }, { merge: true });
    (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
    await seedNumbered('evening', P(25), '4071');
    await checkin({ phone: P(25), number: '4071' });
    const until = (await lock('evening', P(25))).until.toMillis();
    expect(Math.abs(until - lockUntil(schedule))).toBeLessThan(5000);
  });
});

describe('the first time: phone → code → number given → check in (014Fixes)', () => {
  it('works end to end', async () => {
    await seed('evening', P(30));
    expect((await checkin({ phone: P(30) })).body.error.code).toBe('verify_required');
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(30) } });
    const code = /(\d{6})/.exec(fakes.hashback.sent.at(-1).message)[1];
    const verified = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(30), code } });
    expect(verified.body.next).toBe('assignNumber');
    expect((await checkin({ phone: P(30) })).body.error.code).toBe('choose_number');
    const given = await call('/api/student/number', {
      body: { action: 'assign', session: 'evening', phone: P(30), ticket: verified.body.ticket },
    });
    expect(given.status).toBe(200);
    expect((await checkin({ phone: P(30) })).body.error.code).toBe('number_required');
    expect((await checkin({ phone: P(30), number: given.body.number })).status).toBe(200);
  });
});

describe('registration with a number', () => {
  const register = (phone, number) => call('/api/student/register', {
    body: {
      session: 'evening', phone, studentName: 'Amina Wanjiku', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'],
      receiptMessage: 'Paid by M-Pesa QWE123ABC', ...(number === undefined ? {} : { number }),
    },
  });

  // 014Fixes / 02: numbers are GIVEN at registration (after the code); the
  // given-number registration is tests/handlers/fixes014/registerGiven.test.js.
  it('an old page that still sends a chosen number: told to reload, nothing created', async () => {
    const res = await register(P(40), '4071');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('refresh_needed');
    expect((await db.doc(`sessions/evening/students/${P(40)}`).get()).exists).toBe(false);
    expect((await db.doc('sessions/evening/numbers/A4071').get()).exists).toBe(false);
  });
});

describe('performance: the same round trips as today', () => {
  /** Firestore requests one call makes (the emulator answers on 127.0.0.1). */
  async function firestoreRequests(fn) {
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('127.0.0.1:8085')) n += 1;
      return real(input, init);
    };
    try { await fn(); } finally { globalThis.fetch = real; }
    return n;
  }

  it('a repeat check-in with a number costs no more Firestore requests than a phone-only one did', async () => {
    await seedNumbered('evening', P(60), '4071');
    await seed('evening', P(61));
    // First visits (heartbeat, lock) out of the way; flags and session cached.
    await checkin({ phone: P(60), number: '4071' });
    const on = await firestoreRequests(() => checkin({ phone: P(60), number: '4071' }));
    await setFlags(db, { 'auth.legacyStudentRead': true });
    await call('/api/student/checkin', { body: { session: 'evening', phone: P(61) } });
    const off = await firestoreRequests(() => call('/api/student/checkin', { body: { session: 'evening', phone: P(61) } }));
    expect(on).toBe(off);
  });
});

describe('with the flag off, today exactly', () => {
  beforeEach(async () => { await setFlags(db, { 'auth.legacyStudentRead': true }); });

  it('phone-only check-in, no lock, the link by phone; registration takes no number', async () => {
    await seed('evening', P(50));
    const res = await call('/api/student/checkin', { body: { session: 'evening', phone: P(50) } });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(await lock('evening', P(50))).toBeNull();
    expect((await call('/api/class/link', { body: { session: 'evening', phone: P(50) } })).status).toBe(200);
    const reg = await call('/api/student/register', {
      body: { session: 'evening', phone: P(51), studentName: 'Brian Otieno', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: 'Paid by M-Pesa QWE123ABC' },
    });
    expect(reg.status).toBe(200);
    expect(reg.body.next).toBeUndefined();
    expect(reg.body.pass).toMatch(/^v1\./);
  });
});
