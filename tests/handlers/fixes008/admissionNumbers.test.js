import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims, resetFakes,
} from '../_worker.js';

/**
 * 008Fixes / 02 — admission and staff numbers: unique per session (a
 * reservation document CREATED with the number), easy numbers refused, the
 * teacher changes them, staff conversion on mark / unmark, freed on delete,
 * moved with a phone change.
 */

const P = (n) => `+2547151${String(10000 + n).padStart(5, '0')}`;
let db; let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx008-numbers-teacher', teacherClaims.gold);
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
  phoneVerifiedAt: new Date(), ...extra,
});
const record = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const reservation = async (s, id) => (await db.doc(`sessions/${s}/numbers/${id}`).get()).data() ?? null;
// 014Fixes / 00: students no longer choose (they are GIVEN a number:
// tests/handlers/fixes014/numbersGiven.test.js). A held number is set up
// through the teacher's `set` — the same field and reservation.
const setNumber = (session, phone, number) =>
  call('/api/students/admission', { token: teacher, body: { action: 'set', session, phone, number } });
const check = (session, number, kind) =>
  call('/api/student/number', { body: { action: 'check', session, number, ...(kind ? { kind } : {}) } });

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
});

describe('a number is held once per session (set by the teacher)', () => {
  it('takes the number: field on the record and a reservation naming this phone; leading zeros kept', async () => {
    await seed('evening', P(1));
    const res = await setNumber('evening', P(1), '0042');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kind: 'student', number: '0042', display: '0042' });
    expect((await record('evening', P(1))).admissionNumber).toBe('0042');
    expect(await reservation('evening', 'A0042')).toMatchObject({ phone: P(1), kind: 'student', number: '0042' });
  });

  it('a taken number is refused; the same number in the other session is fine (per session)', async () => {
    await seed('evening', P(2));
    await seed('evening', P(3));
    await seed('morning', P(4));
    expect((await setNumber('evening', P(2), '4071')).status).toBe(200);
    const taken = await setNumber('evening', P(3), '4071');
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('number_taken');
    expect((await record('evening', P(3))).admissionNumber).toBeUndefined();
    expect((await setNumber('morning', P(4), '4071')).status).toBe(200);
  });

  it('two records set to one number at the same instant: exactly one holds it', async () => {
    await seed('evening', P(5));
    await seed('evening', P(6));
    const [a, b] = await Promise.all([setNumber('evening', P(5), '5820'), setNumber('evening', P(6), '5820')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const holders = [await record('evening', P(5)), await record('evening', P(6))].filter((r) => r.admissionNumber === '5820');
    expect(holders).toHaveLength(1);
    expect((await reservation('evening', 'A5820')).phone).toBe(holders[0].parentPhone);
  });

  it('easy numbers are refused with the reason', async () => {
    await seed('evening', P(7));
    for (const easy of ['1111', '0000', '1234', '6789', '9876', '3210', '1212', '0101']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await setNumber('evening', P(7), easy);
      expect(res.status, easy).toBe(400);
      expect(res.body.error.code).toBe('easy_number');
      expect(res.body.error.message).toMatch(/too easy to guess/);
    }
    expect((await setNumber('evening', P(7), '12345')).body.error.code).toBe('invalid_number');
  });

  it('a staff record gets a staff number (S-)', async () => {
    await seed('evening', P(11), { staff: true });
    const res = await setNumber('evening', P(11), '0042');
    expect(res.body).toMatchObject({ kind: 'staff', display: 'S-0042' });
    expect((await record('evening', P(11))).staffNumber).toBe('0042');
    expect(await reservation('evening', 'S0042')).toMatchObject({ phone: P(11), kind: 'staff' });
    // S-0042 and student 0042 are different numbers.
    await seed('evening', P(12));
    expect((await setNumber('evening', P(12), '0042')).status).toBe(200);
  });
});

describe('the live check', () => {
  it('says free, taken, or too easy — and never who holds it; one read', async () => {
    await seed('evening', P(13));
    await setNumber('evening', P(13), '4071');
    expect((await check('evening', '4072')).body).toEqual({ status: 'free', message: 'Available' });
    const taken = await check('evening', '4071');
    expect(taken.body.status).toBe('taken');
    expect(JSON.stringify(taken.body)).not.toMatch(/\+254|Student/);
    expect((await check('evening', '1234')).body.status).toBe('easy');
    expect((await check('evening', '12')).body.status).toBe('format');
    expect((await check('evening', '4071', 'staff')).body.status).toBe('free');
  });
});

describe('the teacher sets or changes a number', () => {
  it('frees the old number and takes the new one; taken and easy numbers are refused', async () => {
    await seed('evening', P(20));
    await seed('evening', P(21));
    await setNumber('evening', P(20), '4071');
    await setNumber('evening', P(21), '5820');
    const set = (phone, number) => call('/api/students/admission', { token: teacher, body: { action: 'set', session: 'evening', phone, number } });
    const changed = await set(P(20), '7319');
    expect(changed.status).toBe(200);
    expect((await record('evening', P(20))).admissionNumber).toBe('7319');
    expect(await reservation('evening', 'A4071')).toBeNull();
    expect((await reservation('evening', 'A7319')).phone).toBe(P(20));
    expect((await set(P(20), '5820')).body.error.code).toBe('number_taken');
    expect((await set(P(20), '2222')).body.error.code).toBe('easy_number');
    // A record without a number can be given one.
    await seed('evening', P(22));
    expect((await set(P(22), '4071')).status).toBe(200);
    expect((await reservation('evening', 'A4071')).phone).toBe(P(22));
    // Students can't.
    expect((await call('/api/students/admission', { body: { action: 'set', session: 'evening', phone: P(22), number: '6000' } })).status).toBe(401);
  });
});

describe('staff conversion (owner answer 10)', () => {
  const mark = (items) => call('/api/students/staff', { token: teacher, body: { action: 'mark', items, opId: `op${Date.now()}` } });
  const unmark = (items) => call('/api/students/staff', { token: teacher, body: { action: 'unmark', items } });

  it('marking turns 4071 into S-4071 and frees 4071; unmarking reverses it', async () => {
    await seed('evening', P(30));
    await setNumber('evening', P(30), '4071');
    expect((await mark([{ session: 'evening', phone: P(30) }])).status).toBe(200);
    let r = await record('evening', P(30));
    expect(r).toMatchObject({ staff: true, staffNumber: '4071' });
    expect(r.admissionNumber).toBeUndefined();
    expect(await reservation('evening', 'A4071')).toBeNull();
    expect((await reservation('evening', 'S4071')).phone).toBe(P(30));

    expect((await unmark([{ session: 'evening', phone: P(30) }])).status).toBe(200);
    r = await record('evening', P(30));
    expect(r.admissionNumber).toBe('4071');
    expect(r.staffNumber).toBeUndefined();
    expect(await reservation('evening', 'S4071')).toBeNull();
    expect((await reservation('evening', 'A4071')).phone).toBe(P(30));
  });

  it('when the staff number is taken, the record is left without one (it is given one at check-in)', async () => {
    await seed('evening', P(31), { staff: true });
    await setNumber('evening', P(31), '4071'); // holds S-4071
    await seed('evening', P(32));
    await setNumber('evening', P(32), '4071'); // holds 4071
    await mark([{ session: 'evening', phone: P(32) }]);
    const r = await record('evening', P(32));
    expect(r.staff).toBe(true);
    expect(r.staffNumber).toBeUndefined();
    expect(r.admissionNumber).toBeUndefined();
    expect(await reservation('evening', 'A4071')).toBeNull();
    expect((await reservation('evening', 'S4071')).phone).toBe(P(31));
  });
});

describe('numbers are freed or moved with the record', () => {
  it('deleting a student frees the number', async () => {
    await seed('evening', P(40));
    await setNumber('evening', P(40), '4071');
    const res = await call('/api/student/remove', { token: teacher, body: { session: 'evening', phone: P(40) } });
    expect(res.status).toBe(200);
    expect(await reservation('evening', 'A4071')).toBeNull();
  });

  it('a bulk delete frees every number it removes', async () => {
    await seed('evening', P(41));
    await seed('evening', P(42));
    await setNumber('evening', P(41), '4071');
    await setNumber('evening', P(42), '5820');
    const res = await call('/api/students/bulk', {
      token: teacher,
      body: { action: 'delete', confirm: 'DELETE', items: [{ session: 'evening', phone: P(41) }, { session: 'evening', phone: P(42) }] },
    });
    expect(res.status).toBe(200);
    expect(await reservation('evening', 'A4071')).toBeNull();
    expect(await reservation('evening', 'A5820')).toBeNull();
  });

  it('a phone change moves the reservation and the number; the new phone must be confirmed', async () => {
    await seed('evening', P(43));
    await setNumber('evening', P(43), '4071');
    await db.doc(`sessions/evening/students/${P(43)}/meta/checkinLock`).set({ deviceHash: 'x', until: new Date(Date.now() + 3_600_000) });
    const res = await call('/api/student/update', { token: teacher, body: { session: 'evening', phone: P(43), newPhone: P(44) } });
    expect(res.status).toBe(200);
    const moved = await record('evening', P(44));
    expect(moved.admissionNumber).toBe('4071');
    expect(moved.phoneVerifiedAt).toBeUndefined();
    expect((await reservation('evening', 'A4071')).phone).toBe(P(44));
    expect((await db.doc(`sessions/evening/students/${P(43)}/meta/checkinLock`).get()).exists).toBe(false);
  });

  it('deleting a session takes its reservations with it', async () => {
    await seed('evening', P(45));
    await setNumber('evening', P(45), '4071');
    const { deleteRecursively } = await import('../../../api/_lib/sessions.js');
    await deleteRecursively(db, db.doc('sessions/evening'));
    expect(await reservation('evening', 'A4071')).toBeNull();
  });
});
