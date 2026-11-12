import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 007Fixes / 08 — staff are left out of everything that treats a record as a
 * student (owner, 2026-11-11): no fee or scheduled blocks, no invoices, never
 * held as a duplicate, not counted as waiting, not in student broadcasts. They
 * can still be deleted, and they still get the class link.
 */

const phoneN = (n) => `+2547130${String(80000 + n).padStart(5, '0')}`;
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx007-excl-a', teacherClaims.gold, { email: 'excl.a@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English, Mathematics',
  receiptMessage: `QX${phone.slice(-8)} Confirmed. Ksh2,750.00 sent`, registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const STAFF = { staff: true, staffBy: 'someone', staffAt: new Date('2026-11-01T06:00:00Z') };
const bulk = (body) => call('/api/students/bulk', { token: teacher, body });
const student = async (s, p) => { const x = await db.doc(`sessions/${s}/students/${p}`).get(); return x.exists ? x.data() : null; };
const ledger = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, {
    'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true,
    'whatsapp.broadcast': true, 'whatsapp.advanced': true,
  });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3', 'Grade 7'] });
});

describe('bulk actions skip staff', () => {
  it('block, fee block and approve receipts skip the staff record as "staff"; the students go through', async () => {
    const [kid, teach] = [phoneN(1), phoneN(2)];
    await seed('evening', kid, { pendingReceipt: 'QX1 Confirmed', receiptStatus: 'pending' });
    await seed('evening', teach, { ...STAFF, pendingReceipt: 'QX2 Confirmed', receiptStatus: 'pending' });
    const items = [{ session: 'evening', phone: kid }, { session: 'evening', phone: teach }];

    const approve = await bulk({ action: 'approveReceipts', items });
    expect(approve.body).toMatchObject({ done: 1, skipped: { staff: 1 } });

    const block = await bulk({ action: 'block', kind: 'other', reason: 'x', items });
    expect(block.body).toMatchObject({ done: 1, skipped: { staff: 1 } });
    expect((await student('evening', teach)).blocked).toBe(false);

    const fees = await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session: 'evening', phone: teach }] });
    expect(fees.body).toMatchObject({ done: 0, skipped: { staff: 1 } });
    expect(await ledger('evening', teach)).toEqual([]);
  });

  it('bulk delete still removes a staff record (owner: staff can be deleted)', async () => {
    const teach = phoneN(3);
    await seed('evening', teach, STAFF);
    const res = await bulk({ action: 'delete', confirm: 'DELETE', items: [{ session: 'evening', phone: teach }] });
    expect(res.body.done).toBe(1);
    expect(await student('evening', teach)).toBeNull();
  });

  it('Undo of an unblock does not re-block someone marked as staff since', async () => {
    const teach = phoneN(4);
    await seed('evening', teach, { blocked: true, blockReason: 'x', blockedAt: new Date() });
    const unblock = await bulk({ action: 'unblock', items: [{ session: 'evening', phone: teach }] });
    expect(unblock.body.done).toBe(1);
    const marked = await call('/api/students/staff', { token: teacher, body: { action: 'mark', items: [{ session: 'evening', phone: teach }], opId: 'undo1' } });
    expect(marked.body.marked).toBe(1);
    const undo = await bulk({ action: 'undo', batchId: unblock.body.batchId });
    expect(undo.body).toMatchObject({ undone: 0, changedSince: 1 });
    expect((await student('evening', teach)).blocked).toBe(false);
  });
});

describe('scheduled blocks', () => {
  it('a schedule does not take a staff member', async () => {
    const [kid, teach] = [phoneN(10), phoneN(11)];
    await seed('evening', kid);
    await seed('evening', teach, STAFF);
    const res = await call('/api/students/scheduled', { token: teacher, body: {
      action: 'create', kind: 'other', reason: 'Holiday', atMs: Date.now() + 3_600_000,
      items: [{ session: 'evening', phone: kid }, { session: 'evening', phone: teach }],
    } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ added: 1, skipped: { staff: 1 } });
    expect((await student('evening', teach)).scheduledBlock).toBeUndefined();
  });

  it('someone who became staff after being scheduled is neither blocked nor charged by the sweep', async () => {
    const teach = phoneN(12);
    await seed('evening', teach);
    const res = await call('/api/students/scheduled', { token: teacher, body: {
      action: 'create', kind: 'fees', amount: 2750, atMs: Date.now() + 3_600_000, items: [{ session: 'evening', phone: teach }],
    } });
    expect(res.body.added).toBe(1);
    // Marked by hand (as if marking had not removed the schedule): the sweep is the last guard.
    await db.doc(`sessions/evening/students/${teach}`).set(STAFF, { merge: true });
    await db.doc(`scheduledBlocks/${res.body.batchId}`).update({ dueAtMs: Date.now() - 1000 });
    const sweep = await call('/api/cron/scheduledBlocksSweep', { headers: CRON(), body: {} });
    expect(sweep.status, JSON.stringify(sweep.body)).toBe(200);
    expect((await student('evening', teach)).blocked).toBe(false);
    expect(await ledger('evening', teach)).toEqual([]);
  });
});

describe('fees', () => {
  it('the invoice run skips staff', async () => {
    const [kid, teach] = [phoneN(20), phoneN(21)];
    await seed('morning', kid);
    await seed('morning', teach, STAFF);
    await db.doc('fees/config').set({ defaultFeeByClass: { 'Form 3': 1200 }, billingDayOfMonth: 1, gracePeriodDays: 7, invoicePrefix: 'INV' });
    const res = await call('/api/fees/generateInvoices', { token: teacher, body: { period: '2026-11' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await ledger('morning', kid)).filter((e) => e.type === 'invoice')).toHaveLength(1);
    expect(await ledger('morning', teach)).toEqual([]);
    expect(JSON.stringify(res.body)).toMatch(/"staff"/);
  });

  it('an invoice to a staff record is refused; a payment is still accepted (corrections)', async () => {
    const teach = phoneN(22);
    await seed('morning', teach, STAFF);
    const invoice = await call('/api/fees/post', { token: teacher, body: { session: 'morning', phone: teach, type: 'invoice', amount: 2750 } });
    expect(invoice.status).toBe(409);
    expect(invoice.body.code ?? invoice.body.error?.code).toBe('staff_no_charge');
    const payment = await call('/api/fees/post', { token: teacher, body: { session: 'morning', phone: teach, type: 'payment', amount: 100, method: 'cash' } });
    expect(payment.status, JSON.stringify(payment.body)).toBe(200);
  });

  it('the fee sweep never flags or auto-blocks staff', async () => {
    const [kid, teach] = [phoneN(23), phoneN(24)];
    const past = new Date(Date.now() - 10 * 86_400_000);
    await db.doc('fees/config').set({ autoBlockOnOverdue: true }, { merge: true });
    for (const p of [kid, teach]) {
      await seed('morning', p, p === teach ? STAFF : {});
      await db.doc(`fees/accounts/items/morning__${p}`).set({ key: `morning__${p}`, phone: p, session: 'morning', balance: 500, nextDueDate: past });
    }
    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await student('morning', kid)).toMatchObject({ overdue: true, blocked: true });
    const t = await student('morning', teach);
    expect(t.overdue ?? false).toBe(false);
    expect(t.blocked).toBe(false);
  });
});

describe('duplicates and approvals', () => {
  it('a new registration matching only a staff record is not held', async () => {
    const teach = phoneN(30);
    const kid = phoneN(31); // one digit from the staff number, same name and class
    await seed('evening', teach, { ...STAFF, studentName: 'Kilemi Mwangi', receiptMessage: 'Focus online staff' });
    const res = await call('/api/student/register', { body: {
      session: 'evening', phone: kid, studentName: 'Kilemi Mwangi', class: 'Form 3', subjects: ['English', 'Kiswahili', 'Mathematics'],
      receiptMessage: 'Focus online staff',
    } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = await student('evening', kid);
    expect(s.duplicateHold).toBeUndefined();
  });

  it('the duplicate check ignores a staff record on either side (both copies agree)', async () => {
    const server = await import('../../../api/_lib/duplicates.js');
    const a = { studentName: 'Kilemi', parentPhone: '+254711000001', class: 'Form 3', receiptMessage: 'Focus online staff' };
    const b = { ...a, parentPhone: '+254711000002' };
    expect(server.isDuplicatePair(a, b)).toBe(true);
    expect(server.isDuplicatePair({ ...a, staff: true }, b)).toBe(false);
    expect(server.isDuplicatePair(a, { ...b, staff: true })).toBe(false);
    expect(server.findDuplicateGroups([{ ...a, staff: true }, b])).toEqual([]);
  });

  it('the pre-class waiting count leaves staff out', async () => {
    const { __waitingByClassForTest } = await import('../../../api/_lib/preclassReminder.js');
    await seed('evening', phoneN(32), { approvalStatus: 'pending' });
    await seed('evening', phoneN(33), { ...STAFF, approvalStatus: 'pending' });
    expect(await __waitingByClassForTest(db, 'evening')).toEqual([['Form 3', 1]]);
  });
});

describe('WhatsApp', () => {
  const create = (filter) => call('/api/whatsapp/campaign', { token: teacher, body: {
    action: 'create', title: 'Notice', messageTemplate: 'Dear parent, {{studentName}}', filter,
  } });
  const recipients = async (id) => (await db.collection(`whatsapp/campaigns/items/${id}/recipients`).get()).docs.map((d) => d.id).sort();

  it('"all" leaves staff out; "staff" reaches only staff, opt-out honoured, by session if chosen', async () => {
    const [kid, teachM, teachE, optedOut] = [phoneN(40), phoneN(41), phoneN(42), phoneN(43)];
    await seed('morning', kid);
    await seed('morning', teachM, STAFF);
    await seed('evening', teachE, STAFF);
    await seed('evening', optedOut, { ...STAFF, whatsappOptOut: true });

    const all = await create({ type: 'all' });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(await recipients(all.body.campaignId)).toEqual([kid]);

    const staff = await create({ type: 'staff' });
    expect(staff.status, JSON.stringify(staff.body)).toBe(200);
    expect(await recipients(staff.body.campaignId)).toEqual([teachM, teachE].sort());

    const evening = await create({ type: 'staff', values: ['evening'] });
    expect(await recipients(evening.body.campaignId)).toEqual([teachE]);
  });

  it('"individual" and "class" leave staff out too', async () => {
    const [kid, teach] = [phoneN(44), phoneN(45)];
    await seed('morning', kid);
    await seed('morning', teach, STAFF);
    const ind = await create({ type: 'individual', values: [kid, teach] });
    expect(await recipients(ind.body.campaignId)).toEqual([kid]);
    const cls = await create({ type: 'class', values: ['Form 3'] });
    expect(await recipients(cls.body.campaignId)).toEqual([kid]);
  });
});

describe('class access', () => {
  it('a staff member checks in and gets the class link', async () => {
    const teach = phoneN(50);
    await seed('evening', teach, STAFF);
    await db.doc('sessions/evening/private/classLink').set({ url: 'https://zoom.us/j/123456789', updatedAt: new Date() });
    const checkin = await call('/api/student/checkin', { body: { session: 'evening', phone: teach } });
    expect(checkin.status, JSON.stringify(checkin.body)).toBe(200);
    expect(checkin.body.data ?? checkin.body.student ?? checkin.body).toMatchObject({ blocked: false, approvalStatus: 'approved' });
    const link = await call('/api/class/link', { body: { session: 'evening', phone: teach }, headers: { 'x-checkin-pass': checkin.body.pass } });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(JSON.stringify(link.body)).toMatch(/zoom\.us/);
  });
});
