import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
  fakes, resetFakes,
} from '../_worker.js';

/**
 * 009Fixes / 02 — fix my number (owner, 2026-11-16): a student whose phone
 * was NEVER confirmed (some registered with a fake or mistyped number) moves
 * their record ONCE to their real number: found by the number they
 * registered with, or by name and class; a code to the real number; the
 * whole record moves there, confirmed. Later changes: the teacher only.
 */

const P = (n) => `+2547162${String(10000 + n).padStart(5, '0')}`;
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn(fakes.hashback.sent.at(-1)?.message);
let db; let teacher;

const fix = (body) => call('/api/student/fixNumber', { body: { session: 'evening', ...body } });
const record = async (phone, s = 'evening') => (await db.doc(`sessions/${s}/students/${phone}`).get()).data() ?? null;
const seed = (phone, extra = {}) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: 'Wanjiru Akinyi Moraa', parentPhone: phone, class: 'Form 3', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'evening',
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const moveByNumber = async (oldPhone, newPhone) => {
  const asked = await fix({ action: 'request', oldPhone, newPhone });
  expect(asked.status).toBe(200);
  return fix({ action: 'confirm', oldPhone, newPhone, code: lastCode() });
};

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx009-fix-teacher', teacherClaims.gold, { email: 'fix.teacher@school.example' });
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3', 'Grade 8'] });
});

describe('by the number they registered with', () => {
  it('code to the real number → the whole record moves there, confirmed; then a number is given', async () => {
    await seed(P(1), { feeBalance: 2750, approvalStatus: 'approved' });
    await db.doc(`sessions/evening/students/${P(1)}/notes/n1`).set({ text: 'paid half', createdAt: new Date() });
    await db.doc(`fees/accounts/items/evening__${P(1)}`).set({ key: `evening__${P(1)}`, phone: P(1), session: 'evening', balance: 2750 });
    await db.doc(`fees/accounts/items/evening__${P(1)}/ledger/e1`).set({ type: 'charge', amount: 2750, phone: P(1) });

    const asked = await fix({ action: 'request', oldPhone: P(1), newPhone: P(2) });
    expect(asked.status).toBe(200);
    expect(asked.body.deliveryChannel).toBe('sms');
    expect(fakes.hashback.sent.at(-1).to).toBe(P(2)); // the code goes to the REAL number
    expect(await record(P(2))).toBeNull(); // nothing moves before the code

    const done = await fix({ action: 'confirm', oldPhone: P(1), newPhone: P(2), code: lastCode() });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, phone: P(2), next: 'assignNumber', numberKind: 'student' });
    expect(done.body.ticket).toMatch(/^v1\./);

    expect(await record(P(1))).toBeNull();
    const moved = await record(P(2));
    expect(moved).toMatchObject({ parentPhone: P(2), approvalStatus: 'approved', feeBalance: 2750, numberFixedFrom: P(1) });
    expect(moved.phoneVerifiedAt).toBeTruthy();
    expect(moved.numberFixedAt).toBeTruthy();
    expect(moved.moveInProgress).toBeUndefined();
    expect((await db.doc(`sessions/evening/students/${P(2)}/notes/n1`).get()).exists).toBe(true);
    expect((await db.doc(`fees/accounts/items/evening__${P(2)}/ledger/e1`).get()).exists).toBe(true);
    const audit = (await db.collection('audit').where('action', '==', 'student.number_fixed_by_student').get()).docs;
    expect(audit).toHaveLength(1);

    // Then the usual (014Fixes): a number is given with the ticket.
    const given = await call('/api/student/number', { body: { action: 'assign', session: 'evening', phone: P(2), ticket: done.body.ticket } });
    expect(given.status).toBe(200);
  });

  it('a record that already had a number keeps it (next: checkin); its reservation follows', async () => {
    await seed(P(3), { admissionNumber: '6083', numberChosenAt: new Date() });
    await db.doc('sessions/evening/numbers/A6083').set({ phone: P(3), kind: 'student', number: '6083' });
    const done = await moveByNumber(P(3), P(4));
    expect(done.body.next).toBe('checkin');
    expect((await record(P(4))).admissionNumber).toBe('6083');
    expect((await db.doc('sessions/evening/numbers/A6083').get()).data().phone).toBe(P(4));
  });
});

// 014Fixes / 08: the name-and-class way is gone.
describe('by the old number only', () => {
  it('a name and class instead of the number: refused, nothing sent', async () => {
    await seed(P(5));
    const res = await fix({ action: 'request', studentName: 'Wanjiru Akinyi Moraa', class: 'Form 3', newPhone: P(6) });
    expect(res.status).toBe(400);
    expect(fakes.hashback.sent).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('already confirmed: ask the teacher (once only)', async () => {
    await seed(P(10), { phoneVerifiedAt: new Date() });
    const res = await fix({ action: 'request', oldPhone: P(10), newPhone: P(11) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_confirmed');
  });

  it('once only: after a fix, the same student cannot move again', async () => {
    await seed(P(12));
    expect((await moveByNumber(P(12), P(13))).status).toBe(200);
    const again = await fix({ action: 'request', oldPhone: P(13), newPhone: P(14) });
    expect(again.body.error.code).toBe('already_confirmed');
  });

  it('once only, even after the teacher changes the number (her edit clears "confirmed" but keeps the fix marker)', async () => {
    await seed(P(25));
    expect((await moveByNumber(P(25), P(26))).status).toBe(200);
    // The teacher moves the student to another number: the record is no longer confirmed.
    const res = await call('/api/student/update', { token: teacher, body: { session: 'evening', phone: P(26), newPhone: P(27) } });
    expect(res.status).toBe(200);
    expect((await record(P(27))).phoneVerifiedAt).toBeUndefined();
    expect((await record(P(27))).numberFixedAt).toBeTruthy();
    const sentBefore = fakes.hashback.sent.length;
    const again = await fix({ action: 'request', oldPhone: P(27), newPhone: P(28) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_fixed');
    expect(fakes.hashback.sent.length).toBe(sentBefore);
  });

  it('the real number belongs to another student here, or is retired, or is the same: refused, no SMS', async () => {
    await seed(P(15));
    await seed(P(16), { studentName: 'Other Student Name' });
    await db.doc(`sessions/evening/retiredNumbers/${P(17)}`).set({ reason: 'merged', keptSuffix: '123' });
    expect((await fix({ action: 'request', oldPhone: P(15), newPhone: P(16) })).body.error.code).toBe('number_in_use');
    expect((await fix({ action: 'request', oldPhone: P(15), newPhone: P(17) })).body.error.code).toBe('retired_number');
    expect((await fix({ action: 'request', oldPhone: P(15), newPhone: P(15) })).status).toBe(400);
    expect((await fix({ action: 'request', oldPhone: P(99), newPhone: P(18) })).body.error.code).toBe('not_found');
    expect(fakes.hashback.sent).toHaveLength(0);
  });

  it('a wrong code, or a code of another kind: the generic answer, nothing moves', async () => {
    await seed(P(19));
    await fix({ action: 'request', oldPhone: P(19), newPhone: P(20) });
    const wrong = await fix({ action: 'confirm', oldPhone: P(19), newPhone: P(20), code: '000000' });
    expect(wrong.body.error.code).toBe('invalid_code');
    // A move code cannot register the new number, nor confirm a record.
    const code = lastCode();
    expect((await call('/api/student/verifyCode', { body: { session: 'evening', phone: P(20), code, purpose: 'register' } })).body.error.code).toBe('invalid_code');
    // Nor move a different record.
    await seed(P(21), { studentName: 'Another Person Here' });
    expect((await fix({ action: 'confirm', oldPhone: P(21), newPhone: P(20), code })).body.error.code).toBe('invalid_code');
    expect(await record(P(20))).toBeNull();
    expect(await record(P(19))).toBeTruthy();
  });

  it('admission numbers off: not available (014Fixes / 05: that switch alone)', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': false, 'student.fixNumber': true });
    await seed(P(22));
    const res = await fix({ action: 'request', oldPhone: P(22), newPhone: P(23) });
    expect(res.status).toBe(404);
    expect(fakes.hashback.sent).toHaveLength(0);
  });

  it('five tries an hour for one record', async () => {
    await seed(P(24));
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await fix({ action: 'request', oldPhone: P(24), newPhone: P(30 + i) })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('the teacher', () => {
  it('"Codes waiting" shows the code if the SMS did not arrive', async () => {
    await seed(P(40));
    await fix({ action: 'request', oldPhone: P(40), newPhone: P(41) });
    const res = await call('/api/students/admission', { token: teacher, body: { action: 'codes' } });
    expect(res.body.codes.find((c) => c.phone === P(41))?.code).toBe(lastCode());
  });

  it('a resumed move (ticket) finishes from the marker', async () => {
    await seed(P(42));
    // Simulate a move stopped after step 1: the new record exists, marked.
    const { issueTicket } = await import('../../../api/_lib/verifyTicket.js');
    const old = await record(P(42));
    await db.doc(`sessions/evening/students/${P(43)}`).set({ ...old, parentPhone: P(43), moveInProgress: true, movedFrom: P(42), phoneVerifiedAt: new Date(), numberFixedAt: new Date(), numberFixedFrom: P(42) });
    const res = await fix({ action: 'confirm', newPhone: P(43), ticket: issueTicket({ session: 'evening', phone: P(43) }) });
    expect(res.status).toBe(200);
    expect(await record(P(42))).toBeNull();
    expect((await record(P(43))).moveInProgress).toBeUndefined();
  });
});
