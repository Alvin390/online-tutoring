import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, resetFakes, fakes,
} from '../_worker.js';

/**
 * 014Fixes / 00 — numbers are GIVEN, not chosen (owner, 2026-11-24): after the
 * code, `student/number assign` gives a random free 4-digit number (never an
 * easy one), unique in the session; staff get S-. Safe to retry with the same
 * ticket; an older number is the teacher's ("ask your teacher"). Old pages'
 * `choose` is told the page is out of date. Only `checkin.admissionNumbers`
 * decides (not `student.fixNumber`).
 */

const P = (n) => `+2547140${String(10000 + n).padStart(5, '0')}`;
const DEV = 'device014AAAAAAAAAAAAAAAAAAAAAAAAA';
let db; let issueTicket; let numberProblem;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  ({ issueTicket } = await import('../../../api/_lib/verifyTicket.js'));
  ({ numberProblem } = await import('../../../api/_lib/admissionNumber.js'));
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
  phoneVerifiedAt: new Date(), ...extra,
});
const record = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const reservations = async (s) => (await db.collection(`sessions/${s}/numbers`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const assign = (session, phone, ticket = issueTicket({ session, phone })) =>
  call('/api/student/number', { body: { action: 'assign', session, phone, ticket } });

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s === 'evening' ? 'Evening' : 'Morning', active: true, classes: ['Form 3'] });
});

describe('a number is given', () => {
  it('a random 4-digit number, not easy, on the record and reserved for this phone', async () => {
    await seed('evening', P(1));
    const res = await assign('evening', P(1));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'student' });
    expect(res.body.number).toMatch(/^\d{4}$/);
    expect(res.body.display).toBe(res.body.number);
    expect(numberProblem(res.body.number)).toBeNull();
    const r = await record('evening', P(1));
    expect(r.admissionNumber).toBe(res.body.number);
    expect(r.numberGivenAt).toBeTruthy();
    expect(r.numberChosenAt).toBeUndefined();
    expect(await reservations('evening')).toEqual([expect.objectContaining({ id: `A${res.body.number}`, phone: P(1), kind: 'student' })]);
  });

  it('staff get a staff number (S-)', async () => {
    await seed('evening', P(2), { staff: true });
    const res = await assign('evening', P(2));
    expect(res.body.kind).toBe('staff');
    expect(res.body.display).toBe(`S-${res.body.number}`);
    expect((await record('evening', P(2))).staffNumber).toBe(res.body.number);
    expect((await reservations('evening'))[0].id).toBe(`S${res.body.number}`);
  });

  it('40 students in one session get 40 different numbers, none easy', async () => {
    const phones = Array.from({ length: 40 }, (_, i) => P(100 + i));
    for (const p of phones) await seed('evening', p); // eslint-disable-line no-await-in-loop
    const given = [];
    for (const p of phones) given.push((await assign('evening', p)).body.number); // eslint-disable-line no-await-in-loop
    expect(new Set(given).size).toBe(40);
    expect(given.every((n) => /^\d{4}$/.test(n) && numberProblem(n) === null)).toBe(true);
    expect((await reservations('evening')).length).toBe(40);
  });

  it('then check-in with the phone and that number gets in', async () => {
    await seed('evening', P(3));
    const { number } = (await assign('evening', P(3))).body;
    const checkin = (body) => call('/api/student/checkin', { body: { session: 'evening', deviceId: DEV, phone: P(3), ...body } });
    expect((await checkin({})).body.error.code).toBe('number_required');
    const inside = await checkin({ number });
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    expect(inside.body.exists).toBe(true);
  });
});

describe('who may be given one', () => {
  it('needs the code ticket for this phone in this session', async () => {
    await seed('evening', P(4));
    expect((await assign('evening', P(4), 'v1.0000000000.x')).status).toBe(403);
    expect((await assign('evening', P(4), issueTicket({ session: 'evening', phone: P(5) }))).status).toBe(403);
    expect((await assign('evening', P(4), issueTicket({ session: 'morning', phone: P(4) }))).status).toBe(403);
    expect(await record('evening', P(4))).not.toHaveProperty('admissionNumber');
  });

  it('no record: not found, nothing reserved', async () => {
    const res = await assign('evening', P(6));
    expect(res.status).toBe(404);
    expect(await reservations('evening')).toEqual([]);
  });

  it('a number held from before is the teacher\'s: refused, and never shown', async () => {
    await seed('evening', P(7), { admissionNumber: '4071', numberChosenAt: new Date() });
    await db.doc('sessions/evening/numbers/A4071').set({ phone: P(7), kind: 'student', number: '4071' });
    const res = await assign('evening', P(7));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_has_number');
    expect(res.body.error.message).toBe('You already have an admission number for this class. Ask your teacher for it.');
    expect(JSON.stringify(res.body)).not.toContain('4071');
  });

  it('a number given more than 30 minutes ago is refused the same way', async () => {
    await seed('evening', P(8), { admissionNumber: '5820', numberGivenAt: new Date(Date.now() - 31 * 60 * 1000) });
    await db.doc('sessions/evening/numbers/A5820').set({ phone: P(8), kind: 'student', number: '5820' });
    const res = await assign('evening', P(8));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('5820');
  });

  it('with the switch off: the page is out of date', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': false });
    await seed('evening', P(9));
    const res = await assign('evening', P(9));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('refresh_needed');
  });
});

describe('safe to retry', () => {
  it('the same ticket again right after (a lost answer) gets the same number', async () => {
    await seed('evening', P(10));
    const ticket = issueTicket({ session: 'evening', phone: P(10) });
    const first = await assign('evening', P(10), ticket);
    const again = await assign('evening', P(10), ticket);
    expect(again.status).toBe(200);
    expect(again.body.number).toBe(first.body.number);
    expect((await reservations('evening')).length).toBe(1);
  });

  it('two taps at the same instant: one number, both answers show it', async () => {
    await seed('evening', P(11));
    const [a, b] = await Promise.all([assign('evening', P(11)), assign('evening', P(11))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.number).toBe(b.body.number);
    expect((await reservations('evening')).length).toBe(1);
  });
});

describe('old pages and the code step', () => {
  it('choose is retired: the page is out of date', async () => {
    await seed('evening', P(12));
    const res = await call('/api/student/number', {
      body: { action: 'choose', session: 'evening', phone: P(12), number: '4071', ticket: issueTicket({ session: 'evening', phone: P(12) }) },
    });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatchObject({ code: 'refresh_needed', message: 'This page is out of date. Close it, then open the class link again and check in.' });
    expect(await reservations('evening')).toEqual([]);
  });

  it('after the code, a record without a number is told the next step is to be given one', async () => {
    await seed('evening', P(13), { phoneVerifiedAt: null });
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(13) } });
    const code = /(\d{6})/.exec(fakes.hashback.sent.at(-1).message)[1];
    const verified = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(13), code } });
    expect(verified.body).toMatchObject({ ok: true, next: 'assignNumber', numberKind: 'student' });
    expect((await assign('evening', P(13), verified.body.ticket)).status).toBe(200);
  });
});

describe('one switch: only checkin.admissionNumbers decides', () => {
  const requestRegisterCode = (phone) => call('/api/student/requestCode', { body: { session: 'evening', phone, purpose: 'register' } });
  const cases = [
    { numbers: true, fix: true, works: true },
    { numbers: true, fix: false, works: true },
    { numbers: false, fix: true, works: false },
    { numbers: false, fix: false, works: false },
  ];
  for (const c of cases) {
    it(`numbers ${c.numbers ? 'on' : 'off'}, fixNumber ${c.fix ? 'on' : 'off'}: a registration code ${c.works ? 'is' : 'is not'} given`, async () => {
      await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': c.numbers, 'student.fixNumber': c.fix });
      const res = await requestRegisterCode(P(20));
      if (c.works) {
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const code = /(\d{6})/.exec(fakes.hashback.sent.at(-1).message)[1];
        const verified = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(20), code, purpose: 'register' } });
        expect(verified.body).toMatchObject({ ok: true, next: 'register' });
      } else {
        // Today's answer with the switch off: a registration code is not a thing.
        expect(res.status).toBe(404);
      }
    });
  }
});
