import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, fakes, resetFakes,
} from '../_worker.js';

/**
 * 014Fixes / 05 — "That phone isn't near me" (owner ruling 8): at the code
 * step a student whose phone was never confirmed moves their record to the
 * phone they have — the code goes to the NEW number, the whole record moves
 * (everywhere), once only, no name check. Then a number is given (by SMS to
 * the new phone) and they check in with the new phone. Only
 * checkin.admissionNumbers decides.
 */

const P = (n) => `+2547143${String(10000 + n).padStart(5, '0')}`;
const DEV = 'device014DDDDDDDDDDDDDDDDDDDDDDDDD';
const codeIn = (message) => /Your code is (\d{6})\./.exec(message ?? '')?.[1] ?? null;
const lastCode = () => codeIn([...fakes.hashback.sent].reverse().find((m) => codeIn(m.message))?.message);
let db;

const fix = (body) => call('/api/student/fixNumber', { body: { session: 'evening', ...body } });
const record = async (phone) => (await db.doc(`sessions/evening/students/${phone}`).get()).data() ?? null;
const seed = (phone, extra = {}) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: 'Wanjiru Akinyi', parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'evening',
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const move = async (oldPhone, newPhone) => {
  const asked = await fix({ action: 'request', oldPhone, newPhone });
  if (asked.status !== 200) return asked;
  return fix({ action: 'confirm', oldPhone, newPhone, code: lastCode() });
};
const checkin = (phone, number) => call('/api/student/checkin', { body: { session: 'evening', deviceId: DEV, phone, ...(number ? { number } : {}) } });

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
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('moving to the phone they have', () => {
  it('code to the new phone → moved → a number given (SMS to the new phone) → in with the new phone', async () => {
    await seed(P(1));
    const done = await move(P(1), P(2));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ ok: true, phone: P(2), next: 'assignNumber' });
    expect(await record(P(1))).toBeNull();

    const given = await call('/api/student/number', { body: { action: 'assign', session: 'evening', phone: P(2), ticket: done.body.ticket } });
    expect(given.status).toBe(200);
    const numberSms = fakes.hashback.sent.filter((m) => m.message.startsWith('Your admission number'));
    expect(numberSms).toEqual([expect.objectContaining({ to: P(2) })]);

    expect((await checkin(P(2))).body.error.code).toBe('number_required');
    expect((await checkin(P(2), given.body.number)).status).toBe(200);
  });

  it('a record that already had a number keeps it: in with the new phone and that number', async () => {
    await seed(P(3), { admissionNumber: '6083', numberChosenAt: new Date() });
    await db.doc('sessions/evening/numbers/A6083').set({ phone: P(3), kind: 'student', number: '6083' });
    const done = await move(P(3), P(4));
    expect(done.body.next).toBe('checkin');
    const inside = await checkin(P(4), '6083');
    expect(inside.status, JSON.stringify(inside.body)).toBe(200);
  });
});

describe('the limits', () => {
  it('once per student: a second move is refused', async () => {
    await seed(P(5));
    await move(P(5), P(6));
    // The moved record is confirmed now; a further change is the teacher's.
    const again = await fix({ action: 'request', oldPhone: P(6), newPhone: P(7) });
    expect(again.status).toBe(409);
    expect(['already_confirmed', 'already_fixed']).toContain(again.body.error.code);
  });

  it('the new number already registered here: refused with the approved words', async () => {
    await seed(P(8));
    await seed(P(9));
    const res = await fix({ action: 'request', oldPhone: P(8), newPhone: P(9) });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('That number is already registered for another student in this class. Ask your teacher.');
  });

  it('student.fixNumber off changes nothing (one switch)', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true, 'student.fixNumber': false });
    await seed(P(10));
    const done = await move(P(10), P(11));
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  });

  it('admission numbers off: not available', async () => {
    await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': false, 'student.fixNumber': true });
    await seed(P(12));
    expect((await fix({ action: 'request', oldPhone: P(12), newPhone: P(13) })).status).toBe(404);
  });
});
