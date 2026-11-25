import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, fakes, resetFakes,
} from '../_worker.js';

/**
 * 014Fixes / 02 — registration gives the number (owner rulings 9 and 10):
 * form → code → saved (confirmed) with a GIVEN number in the same
 * transaction → the number by SMS once. With approval on it is saved pending
 * and still has its number. A page that still sends a chosen number is told
 * it is out of date; nothing is saved. Only checkin.admissionNumbers decides.
 */

const P = (n) => `+2547142${String(10000 + n).padStart(5, '0')}`;
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn([...fakes.hashback.sent].reverse().find((m) => codeIn(m.message))?.message);
let db; let issueTicket; let numberProblem;

const form = (phone, extra = {}) => ({
  session: 'evening', phone, studentName: 'New Student', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'],
  receiptMessage: 'Paid by M-Pesa QWE123 for the class', ...extra,
});
const register = (body) => call('/api/student/register', { body });
const record = async (phone) => (await db.doc(`sessions/evening/students/${phone}`).get()).data() ?? null;
const reservations = async () => (await db.collection('sessions/evening/numbers').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ticketFor = (phone) => issueTicket({ session: 'evening', phone });

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  ({ issueTicket } = await import('../../../api/_lib/verifyTicket.js'));
  ({ numberProblem } = await import('../../../api/_lib/admissionNumber.js'));
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('registering gives a number', () => {
  it('form → code → saved, confirmed, with a given number; one SMS with it', async () => {
    await call('/api/student/requestCode', { body: { session: 'evening', phone: P(1), purpose: 'register' } });
    const verified = await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(1), code: lastCode(), purpose: 'register' } });
    const res = await register(form(P(1), { ticket: verified.body.ticket }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.next).toBe('checkin');
    expect(res.body.number).toMatchObject({ kind: 'student' });
    expect(res.body.number.digits).toMatch(/^\d{4}$/);
    expect(res.body.number.display).toBe(res.body.number.digits);
    expect(numberProblem(res.body.number.digits)).toBeNull();

    const r = await record(P(1));
    expect(r).toMatchObject({ admissionNumber: res.body.number.digits, approvalStatus: 'pending' });
    expect(r.phoneVerifiedAt).toBeTruthy();
    expect(r.numberGivenAt).toBeTruthy();
    expect(r.numberChosenAt).toBeUndefined();
    expect(r.numberSmsAt).toBeTruthy();
    expect(await reservations()).toEqual([expect.objectContaining({ id: `A${res.body.number.digits}`, phone: P(1), kind: 'student' })]);

    const numberSms = fakes.hashback.sent.filter((m) => m.message.startsWith('Your admission number'));
    expect(numberSms).toEqual([expect.objectContaining({
      to: P(1),
      message: `Your admission number for Evening is ${res.body.number.digits}. Use it with this phone number every time you check in. Keep it safe.`,
    })]);
  });

  it('then check-in with the phone and that number answers (approval still pending)', async () => {
    const res = await register(form(P(2), { ticket: ticketFor(P(2)) }));
    const inside = await call('/api/student/checkin', {
      body: { session: 'evening', phone: P(2), number: res.body.number.digits, deviceId: 'device014RRRRRRRRRRRRRRRRRRRRRRRRR' },
    });
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
    expect(inside.body.student.approvalStatus).toBe('pending');
  });

  it('a lost answer, retried with the same ticket, gets the same number', async () => {
    const ticket = ticketFor(P(3));
    const first = await register(form(P(3), { ticket }));
    const again = await register(form(P(3), { ticket }));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.number.digits).toBe(first.body.number.digits);
    expect(await reservations()).toHaveLength(1);
    expect(fakes.hashback.sent.filter((m) => m.message.startsWith('Your admission number'))).toHaveLength(1);
  });

  it('registered before (not just now): still "already registered"', async () => {
    await db.doc(`sessions/evening/students/${P(4)}`).set({
      studentName: 'Old', parentPhone: P(4), class: 'Form 3', session: 'evening', approvalStatus: 'approved',
      admissionNumber: '4071', numberChosenAt: new Date(), registeredAt: new Date('2026-10-01T06:00:00Z'),
    });
    const res = await register(form(P(4), { ticket: ticketFor(P(4)) }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_registered');
    expect(JSON.stringify(res.body)).not.toContain('4071');
  });
});

describe('old pages and missing proof', () => {
  it('a page that still sends a chosen number: out of date, nothing saved', async () => {
    const res = await register(form(P(5), { ticket: ticketFor(P(5)), number: '4071' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('refresh_needed');
    expect(await record(P(5))).toBeNull();
    expect(await reservations()).toEqual([]);
  });

  it('no ticket: out of date; a wrong ticket: confirm first; nothing saved', async () => {
    expect((await register(form(P(6)))).body.error.code).toBe('refresh_needed');
    expect((await register(form(P(6), { ticket: ticketFor(P(7)) }))).body.error.code).toBe('verify_first');
    expect(await record(P(6))).toBeNull();
  });
});

describe('one switch', () => {
  it('student.fixNumber off with numbers on: registration still gives a number', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': false });
    const res = await register(form(P(8), { ticket: ticketFor(P(8)) }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.number.digits).toMatch(/^\d{4}$/);
  });

  it('numbers off: registration exactly as before (no number, no code, a pass)', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': false, 'student.fixNumber': true });
    const res = await register(form(P(9)));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.number).toBeUndefined();
    expect(res.body.next).toBeUndefined();
    expect(res.body.pass).toBeTruthy();
    const r = await record(P(9));
    expect(r.admissionNumber).toBeUndefined();
    expect(r.phoneVerifiedAt).toBeUndefined();
    expect(fakes.hashback.sent).toHaveLength(0);
  });
});
