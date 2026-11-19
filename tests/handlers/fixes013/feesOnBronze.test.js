import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 05 — fees are Silver and up. On a plan without them (Bronze, or
 * after a downgrade) no money reaches teachers or students, the fee jobs do
 * nothing, and the data is kept: it is all there again after an upgrade.
 */

const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db;
let teacher;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx013f-teacher', teacherClaims.gold); // the claim never decides
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  await db.doc('sessions/morning/private/classLink').set({ url: 'https://zoom.us/j/1234567890', provider: 'zoom' });
});

const seed = (phone, extra = {}) => db.doc(`sessions/morning/students/${phone}`).set({
  studentName: 'Kid', parentPhone: phone, class: 'Form 3', subjects: 'English', session: 'morning',
  receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date('2026-10-01T06:00:00Z'),
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const summary = (phone, token = teacher) => call('/api/fees/summary', { token, body: { session: 'morning', phone } });
const checkin = (phone) => call('/api/student/checkin', { body: { session: 'morning', phone } });
const invoice = (phone, amount) => call('/api/fees/post', { token: teacher, body: { session: 'morning', phone, type: 'invoice', amount } });
const ledgerSize = async (phone) => (await db.collection(`fees/accounts/items/morning__${phone}/ledger`).get()).size;

describe('no money on a plan without fees', () => {
  it('the fee summary answers as if fees were off — to the teacher too', async () => {
    await seedPlan(db, 'silver');
    await seed(phoneN(1));
    expect((await invoice(phoneN(1), 2750)).status).toBe(200);
    await seedPlan(db, 'bronze');
    const res = await summary(phoneN(1));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ feesEnabled: false, summary: null });
  });

  it('check-in sends no balance and says money is not shown', async () => {
    await seedPlan(db, 'bronze');
    await seed(phoneN(2), { feeBalance: 1500 });
    const res = await checkin(phoneN(2));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.student).toMatchObject({ feeBalance: 0, feesShown: false });
    expect(JSON.stringify(res.body)).not.toContain('1500');
  });

  it('on Silver check-in shows the balance as before', async () => {
    await seedPlan(db, 'silver');
    await seed(phoneN(3), { feeBalance: 1500 });
    expect((await checkin(phoneN(3))).body.student).toMatchObject({ feeBalance: 1500, feesShown: true });
  });

  it('a teacher cannot write a balance through a student edit (on any plan)', async () => {
    await seedPlan(db, 'bronze');
    await seed(phoneN(4));
    const res = await call('/api/student/update', { token: teacher, body: { session: 'morning', phone: phoneN(4), changes: { feeBalance: 0 } } });
    expect(res.status).toBe(400);
  });
});

describe('the fee jobs on a plan without fees', () => {
  it('the daily sweep flags, blocks and invoices nothing', async () => {
    await seedPlan(db, 'silver');
    await seed(phoneN(5));
    await invoice(phoneN(5), 2750);
    // Overdue by any measure, with auto-block on and today the billing day.
    await db.doc(`fees/accounts/items/morning__${phoneN(5)}`).set({ nextDueDate: new Date(Date.now() - 30 * 86_400_000) }, { merge: true });
    await db.doc('fees/config').set({ autoBlockOnOverdue: true, graceDays: 0, billingDayOfMonth: Math.min(new Date().getUTCDate(), 28), defaultFeeKes: 500 });
    const before = await ledgerSize(phoneN(5));
    await seedPlan(db, 'bronze');

    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: 'plan_without_fees' });
    expect(await ledgerSize(phoneN(5))).toBe(before);
    const s = (await db.doc(`sessions/morning/students/${phoneN(5)}`).get()).data();
    expect(s.blocked).toBe(false);
    expect(s.overdue).toBeUndefined();
  });

  it('on Silver the sweep runs as before', async () => {
    await seedPlan(db, 'silver');
    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeUndefined();
  });
});

describe('a downgrade hides; an upgrade brings it all back', () => {
  it('Silver → Bronze → Silver: the same balance and ledger', async () => {
    await seedPlan(db, 'silver');
    await seed(phoneN(6));
    await invoice(phoneN(6), 2750);
    await invoice(phoneN(6), 550);
    const before = (await summary(phoneN(6))).body;
    expect(before.summary.balance).toBe(3300);
    const entries = await ledgerSize(phoneN(6));

    await seedPlan(db, 'bronze');
    expect((await summary(phoneN(6))).body.summary).toBeNull();

    await seedPlan(db, 'silver');
    const after = (await summary(phoneN(6))).body;
    expect(after.summary).toEqual(before.summary);
    expect(await ledgerSize(phoneN(6))).toBe(entries);
  });
});
