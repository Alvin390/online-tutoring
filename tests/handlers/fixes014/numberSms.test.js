import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, resetFakes, fakes, drainWaitUntil,
} from '../_worker.js';

/**
 * 014Fixes / 01 — the number by SMS, ONCE (owner ruling 6): after a number
 * is given, one SMS names the session and the number. From the owner's
 * wallet like the codes (never the school's SMS units); skipped below the
 * wallet reserve, which keeps check-in codes working; a failure never
 * blocks, and never sends it twice.
 */

const P = (n) => `+2547141${String(10000 + n).padStart(5, '0')}`;
let db; let issueTicket;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  ({ issueTicket } = await import('../../../api/_lib/verifyTicket.js'));
});

const seed = (phone, extra = {}) => db.doc(`sessions/evening/students/${phone}`).set({
  studentName: `Student ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Paid by M-Pesa QWE123', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'evening',
  blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
  phoneVerifiedAt: new Date(), ...extra,
});
const record = async (p) => (await db.doc(`sessions/evening/students/${p}`).get()).data() ?? null;
const assign = (phone, opts = {}) => call('/api/student/number', {
  body: { action: 'assign', session: 'evening', phone, ticket: opts.ticket ?? issueTicket({ session: 'evening', phone }) }, ...opts,
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  resetFakes();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'checkin.admissionNumbers': true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true, classes: ['Form 3'] });
});

describe('the number by SMS', () => {
  it('one SMS to the phone, naming the session and the number', async () => {
    await seed(P(1));
    const res = await assign(P(1));
    expect(res.status).toBe(200);
    expect(fakes.hashback.sent).toHaveLength(1);
    expect(fakes.hashback.sent[0].to).toBe(P(1));
    expect(fakes.hashback.sent[0].message).toBe(
      `Your admission number for Evening class is ${res.body.number}. Use it with this phone number every time you check in. Keep it safe.`,
    );
    expect((await record(P(1))).numberSmsAt).toBeTruthy();
  });

  it('staff: the staff number', async () => {
    await seed(P(2), { staff: true });
    const res = await assign(P(2));
    expect(fakes.hashback.sent[0].message).toBe(
      `Your staff number for Evening class is S-${res.body.number}. Use it with this phone number every time you check in. Keep it safe.`,
    );
  });

  it('only once: a retry with the same ticket sends nothing more', async () => {
    await seed(P(3));
    const ticket = issueTicket({ session: 'evening', phone: P(3) });
    await assign(P(3), { ticket });
    await assign(P(3), { ticket });
    expect(fakes.hashback.sent).toHaveLength(1);
  });

  it('never on the answer\'s path', async () => {
    await seed(P(4));
    const res = await assign(P(4), { drain: false });
    expect(res.status).toBe(200);
    await drainWaitUntil();
    expect(fakes.hashback.sent).toHaveLength(1);
  });

  it('never uses the school\'s SMS units', async () => {
    await seed(P(5));
    await assign(P(5));
    expect((await db.doc('sms/credits').get()).exists).toBe(false);
  });
});

describe('when it cannot go', () => {
  it('below the wallet reserve: not sent (codes come first), the number is still given', async () => {
    await db.doc('config/smsBalance').set({ balance: 50, fullAt: 400 });
    await seed(P(6));
    const res = await assign(P(6));
    expect(res.status).toBe(200);
    expect(fakes.hashback.sent).toHaveLength(0);
    expect((await record(P(6))).numberSmsAt).toBeUndefined();
  });

  it('the SMS provider failing: the number is still given, and the record says it was not sent', async () => {
    fakes.hashback.fail = { code: 'SERVER_ERROR', status: 500 };
    await seed(P(7));
    const res = await assign(P(7));
    expect(res.status).toBe(200);
    expect(res.body.number).toMatch(/^\d{4}$/);
    expect((await record(P(7))).numberSmsAt).toBeUndefined();
  });
});
