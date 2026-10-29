import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 003Fixes / 11 — a second registration of the same student (same session,
 * name and class, plus the same receipt or a near-identical number) is
 * accepted but HELD: pending, `duplicateHold`, `duplicateOf`. The student is
 * told only that it is held; the class link refuses it with the approval flag
 * on or off; approving clears the hold and keeps `duplicateOf`.
 */

let db;
let teacher;
const ORIGINAL = phoneN(7000);
const RECEIPT = 'QX12345678 Confirmed. Ksh1,000.00 sent to TEACHER';

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx003-dup-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'registration.requireApproval': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true, classes: ['Grade 7', 'Grade 8'] });
  await db.doc('sessions/morning/private/classLink').set({ url: 'https://zoom.us/j/123456789', provider: 'zoom' });
  await db.doc(`sessions/morning/students/${ORIGINAL}`).set({
    studentName: "Zoë O'Brien", parentPhone: ORIGINAL, class: 'Grade 7', subjects: 'English, Kiswahili, Mathematics',
    receiptMessage: RECEIPT, session: 'morning', blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
  });
});

const register = (phone, over = {}) => call('/api/student/register', {
  body: {
    session: 'morning', phone, studentName: 'zoe obrien', class: 'Grade 7',
    subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: RECEIPT, ...over,
  },
});
const stored = async (phone) => (await db.doc(`sessions/morning/students/${phone}`).get()).data();
const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);

describe('registering', () => {
  it('the same name, class and receipt under a new number: accepted, held, duplicateOf set; nobody else named', async () => {
    const res = await register(phoneN(7100));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.held).toBe('duplicate');
    expect(res.body.student.duplicateHold).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(ORIGINAL);
    expect(JSON.stringify(res.body)).not.toMatch(/Zoë|O'Brien/);
    const doc = await stored(phoneN(7100));
    expect(doc).toMatchObject({ approvalStatus: 'pending', duplicateHold: true, duplicateOf: ORIGINAL });
  });

  it('a different class registers normally', async () => {
    const res = await register(phoneN(7101), { class: 'Grade 8' });
    expect(res.status).toBe(200);
    expect(res.body.held).toBeUndefined();
    expect((await stored(phoneN(7101))).duplicateHold).toBeUndefined();
  });

  it('a different receipt but a number 1 digit off: held; 3+ digits off: normal', async () => {
    const near = await register(phoneN(7001), { receiptMessage: 'RZ98765432 Confirmed. Ksh1,000.00' });
    expect(near.body.held).toBe('duplicate');
    const far = await register(phoneN(7432), { receiptMessage: 'RZ98765433 Confirmed. Ksh1,000.00' });
    expect(far.body.held).toBeUndefined();
  });

  it('costs one more subrequest than a plain registration, and no more', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const plain = await register(phoneN(7200), { class: 'Grade 8', studentName: 'Brian Otieno', receiptMessage: 'AB12345678 ok paid' });
      const dup = await register(phoneN(7201));
      expect(dup.body.held).toBe('duplicate');
      // Both now make the one class query; holding adds nothing on top.
      expect(subreq(dup)).toBeLessThanOrEqual(subreq(plain) + 1);
      console.log(`[p11] register subrequests: plain ${subreq(plain)}, held ${subreq(dup)}`);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});

describe('the held student', () => {
  it("check-in says held and carries no one else's data; the class link refuses with the flag on and off", async () => {
    await register(phoneN(7100));
    const check = await call('/api/student/checkin', { body: { session: 'morning', phone: phoneN(7100) } });
    expect(check.body.student.duplicateHold).toBe(true);
    expect(check.body.student.duplicateOf).toBeUndefined();
    expect(JSON.stringify(check.body)).not.toContain(ORIGINAL);

    for (const flag of [true, false]) {
      await setFlags(db, { 'registration.requireApproval': flag });
      const link = await call('/api/class/link', { body: { session: 'morning', phone: phoneN(7100) } });
      expect(link.status, `flag ${flag}`).toBe(403);
      expect(link.body.error.code).toBe('duplicate_hold');
    }
  });

  it('after the teacher approves: check-in is normal, the link opens, duplicateOf remains', async () => {
    await register(phoneN(7100));
    const approve = await call('/api/student/approve', { token: teacher, body: { session: 'morning', decision: 'approve', phones: [phoneN(7100)] } });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const doc = await stored(phoneN(7100));
    expect(doc.duplicateHold).toBeUndefined();
    expect(doc.duplicateOf).toBe(ORIGINAL);
    const check = await call('/api/student/checkin', { body: { session: 'morning', phone: phoneN(7100) } });
    expect(check.body.student.duplicateHold).toBe(false);
    const link = await call('/api/class/link', { body: { session: 'morning', phone: phoneN(7100) } });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
  });
});
