import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
  fakes, resetFakes, externalCalls,
} from '../_worker.js';

/**
 * 008Fixes / 01 — one-time codes by SMS through HashBack (owner answers 1, 3).
 * The fake HashBack (tests/handlers/_worker.js) records each send; nothing
 * real is sent or charged.
 */

const P = (n) => `+2547150${String(10000 + n).padStart(5, '0')}`;
let db; let teacher;
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn(fakes.hashback.sent.at(-1)?.message);
const otpRef = async (phone) => {
  const { sha256 } = await import('../../../api/_lib/crypto.js');
  return db.collection('otp').doc(sha256(phone));
};

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx008-codes-teacher', teacherClaims.gold);
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
});

describe('requesting a code', () => {
  it('sends ONE SMS with the code to that phone; the reply never contains it', async () => {
    await seed('evening', P(1));
    const res = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(1) } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deliveryChannel: 'sms', expiresInSeconds: 600, retryAfterSeconds: 60 });
    expect(JSON.stringify(res.body)).not.toMatch(/\d{6}/);
    const sends = externalCalls.filter((c) => c.url.startsWith('https://api.hashback.co.ke/sms/send'));
    expect(sends).toHaveLength(1);
    expect(sends[0].body.to).toBe(P(1));
    expect(sends[0].body.message).toMatch(/^Your code is \d{6}\. It expires in 10 minutes\. Do not share it\.$/);
    // One unit (well under 168 characters).
    expect(sends[0].body.message.length).toBeLessThan(168);
    // The code is stored as a hash and an encrypted copy, never readable.
    const stored = (await (await otpRef(P(1))).get()).data();
    expect(JSON.stringify(stored)).not.toContain(lastCode());
  });

  it('records the wallet balance the send reported', async () => {
    await seed('evening', P(2));
    fakes.hashback.balance = 120;
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(2) } });
    const balance = (await db.doc('config/smsBalance').get()).data();
    expect(balance.balance).toBeCloseTo(119.65, 2);
  });

  it('"Send again" within 60 s waits; after it, a NEW code replaces the old one', async () => {
    await seed('evening', P(3));
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(3) } });
    const first = lastCode();
    const again = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(3) } });
    expect(again.status).toBe(429);
    expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fakes.hashback.sent).toHaveLength(1);

    // 61 seconds later.
    await (await otpRef(P(3))).set({ sentAt: new Date(Date.now() - 61_000) }, { merge: true });
    const later = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(3) } });
    expect(later.status).toBe(200);
    const second = lastCode();
    expect(fakes.hashback.sent).toHaveLength(2);

    if (first !== second) {
      const old = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(3), code: first } });
      expect(old.status).toBe(400);
    }
    const ok = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(3), code: second } });
    expect(ok.status).toBe(200);
  });

  it('no credit: the code is still issued, for the teacher to read out', async () => {
    await seed('evening', P(4));
    fakes.hashback.fail = { code: 'INSUFFICIENT_FUNDS', status: 402 };
    const res = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(4) } });
    expect(res.status).toBe(200);
    expect(res.body.deliveryChannel).toBe('teacher');
    const list = await call('/api/students/admission', { token: teacher, body: { action: 'codes' } });
    expect(list.status).toBe(200);
    expect(list.body.codes).toHaveLength(1);
    expect(list.body.codes[0]).toMatchObject({ session: 'evening', phoneEnding: P(4).slice(-3), name: `Student ${P(4).slice(-3)}` });
    expect(list.body.codes[0].code).toMatch(/^\d{6}$/);
  });

  it('no key: the same fallback, and no request leaves', async () => {
    await seed('evening', P(5));
    const before = process.env.HASHBACK_API_KEY;
    process.env.HASHBACK_API_KEY = '';
    try {
      const res = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(5) } });
      expect(res.body.deliveryChannel).toBe('teacher');
      expect(externalCalls.filter((c) => c.url.includes('hashback'))).toHaveLength(0);
    } finally {
      process.env.HASHBACK_API_KEY = before;
    }
  });

  it('confirmed but no number yet (page closed in between): a code again, to get the ticket', async () => {
    await seed('evening', P(9), { phoneVerifiedAt: new Date() });
    const res = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(9) } });
    expect(res.status).toBe(200);
    const ok = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(9), code: lastCode() } });
    expect(ok.body).toMatchObject({ next: 'chooseNumber' });
  });

  it('a confirmed phone with a number is refused (no repeated SMS cost); an unknown number gets 404', async () => {
    await seed('evening', P(6), { phoneVerifiedAt: new Date(), admissionNumber: '4071' });
    const verified = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(6) } });
    expect(verified.status).toBe(409);
    expect(verified.body.error.code).toBe('already_verified');
    const unknown = await call('/api/student/requestCode', { body: { session: 'evening', phone: P(7) } });
    expect(unknown.status).toBe(404);
    expect(fakes.hashback.sent).toHaveLength(0);
  });

  it('at most 6 codes an hour for one number, whatever the address', async () => {
    await seed('evening', P(8));
    const ref = await otpRef(P(8));
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ref.set({ sentAt: new Date(Date.now() - 61_000) }, { merge: true }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await call('/api/student/requestCode', { body: { session: 'evening', phone: P(8) } })).status);
    }
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
});

describe('the teacher reads waiting codes', () => {
  it('lists only unexpired, unused codes; students and signed-out callers are refused', async () => {
    await seed('evening', P(10));
    await seed('morning', P(11));
    await seed('evening', P(12));
    for (const [s, p] of [['evening', P(10)], ['morning', P(11)], ['evening', P(12)]]) {
      // eslint-disable-next-line no-await-in-loop
      await call('/api/student/requestCode', { body: { session: s, phone: p } });
    }
    const codeOf11 = codeIn(fakes.hashback.sent[1].message);
    // P(10)'s has expired; P(12)'s was used.
    await (await otpRef(P(10))).set({ expiresAt: new Date(Date.now() - 1000) }, { merge: true });
    const used = codeIn(fakes.hashback.sent[2].message);
    expect((await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(12), code: used } })).status).toBe(200);

    const res = await call('/api/students/admission', { token: teacher, body: { action: 'codes' } });
    expect(res.body.codes.map((c) => c.phoneEnding)).toEqual([P(11).slice(-3)]);
    expect(res.body.codes[0].code).toBe(codeOf11);
    expect(res.body.codes[0].expiresAtMs).toBeGreaterThan(Date.now());

    expect((await call('/api/students/admission', { body: { action: 'codes' } })).status).toBe(401);
    const student = await userWithClaims('fx008-codes-student', { role: 'student', phone: P(11) });
    expect((await call('/api/students/admission', { token: student, body: { action: 'codes' } })).status).toBe(403);
  });
});

describe('confirming the code', () => {
  it('stamps the phone confirmed, returns a ticket and what comes next; mints no Firebase user', async () => {
    await seed('evening', P(20));
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(20) } });
    const res = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(20), code: lastCode() } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, next: 'chooseNumber', numberKind: 'student' });
    expect(res.body.ticket).toMatch(/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(res.body.customToken).toBeUndefined();
    const record = (await db.doc(`sessions/evening/students/${P(20)}`).get()).data();
    expect(record.phoneVerifiedAt).toBeTruthy();
    expect(record.studentUid).toBeUndefined();
  });

  it('a staff record is told it chooses a staff number; one with a number goes to check-in', async () => {
    await seed('evening', P(21), { staff: true });
    await seed('evening', P(22), { admissionNumber: '4071' });
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(21) } });
    const staff = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(21), code: lastCode() } });
    expect(staff.body).toMatchObject({ next: 'chooseNumber', numberKind: 'staff' });
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(22) } });
    const numbered = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(22), code: lastCode() } });
    expect(numbered.body).toMatchObject({ next: 'checkin', numberKind: 'student' });
  });

  it('a code asked for one session does not confirm the other', async () => {
    await seed('evening', P(23));
    await seed('morning', P(23));
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(23) } });
    const res = await call('/api/student/verifyCode', { body: { session: 'morning', phone: P(23), code: lastCode() } });
    expect(res.status).toBe(400);
    expect((await db.doc(`sessions/morning/students/${P(23)}`).get()).data().phoneVerifiedAt).toBeUndefined();
  });

  it('a record deleted after the code was sent is not recreated', async () => {
    await seed('evening', P(24));
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(24) } });
    await db.doc(`sessions/evening/students/${P(24)}`).delete();
    const res = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(24), code: lastCode() } });
    expect(res.status).toBe(404);
    expect((await db.doc(`sessions/evening/students/${P(24)}`).get()).exists).toBe(false);
  });
});
