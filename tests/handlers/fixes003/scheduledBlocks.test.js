import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 003Fixes / 07 — scheduled blocks: exact at the minute (check-in and the class
 * link read the student's own `scheduledBlock`), recorded by the per-minute
 * sweep (fee charged then, Undo record), and dropped for anyone who pays first.
 * Also the batched ledger posting (postEntries) that lets fee work run 25 a call.
 */

let db;
let gold;
let other;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx003-sched-gold', teacherClaims.gold);
  other = await userWithClaims('fx003-sched-other', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  await db.doc('sessions/morning/private/classLink').set({ url: 'https://zoom.us/j/1234567890', provider: 'zoom' });
});

afterEach(() => vi.useRealTimers());

const seed = (phone, extra = {}) => db.doc(`sessions/morning/students/${phone}`).set({
  studentName: 'Student', parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'morning',
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const student = async (phone) => (await db.doc(`sessions/morning/students/${phone}`).get()).data();
const items = (...phones) => phones.map((phone) => ({ session: 'morning', phone }));
const sched = (body, token = gold) => call('/api/students/scheduled', { body, token });
const sweep = () => call('/api/cron/scheduledBlocksSweep', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {} });
const checkin = (phone) => call('/api/student/checkin', { body: { session: 'morning', phone } });
const link = (phone) => call('/api/class/link', { body: { session: 'morning', phone } });
const goTo = (ms) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ms); };

describe('create, and exact enforcement at the minute', () => {
  it('before the time: in class as normal; from the time: blocked at check-in and refused the link, with no sweep yet', async () => {
    await seed(phoneN(1));
    const at = Date.now() + 10 * 60_000;
    const res = await sched({ action: 'create', items: items(phoneN(1)), atMs: at, kind: 'other', reason: 'Next week’s fee is due' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ added: 1 });
    const s = await student(phoneN(1));
    expect(s.scheduledBlock).toMatchObject({ batchId: res.body.batchId, atMs: at, kind: 'other' });
    expect(s.blocked).toBe(false);

    expect((await checkin(phoneN(1))).body.student.blocked).toBe(false);
    expect((await link(phoneN(1))).status).toBe(200);

    goTo(at + 1000);
    const late = await checkin(phoneN(1));
    expect(late.body.student).toMatchObject({ blocked: true, blockReason: 'Next week’s fee is due' });
    expect(JSON.stringify(late.body)).not.toContain(res.body.batchId);
    const refused = await link(phoneN(1));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('blocked');
  });

  it('a fee schedule that is due but not yet recorded says the amount is being recorded, never "KES 0"', async () => {
    await seed(phoneN(2));
    const at = Date.now() + 10 * 60_000;
    await sched({ action: 'create', items: items(phoneN(2)), atMs: at, kind: 'fees', amount: 1500 });
    goTo(at + 1000);
    const res = await checkin(phoneN(2));
    expect(res.body.student).toMatchObject({ blocked: true, feeBalance: 0 });
    expect(res.body.student.blockReason).toMatch(/recording the amount/);
  });

  it('a student due a scheduled block can send a receipt (as any blocked student can)', async () => {
    await seed(phoneN(3));
    const at = Date.now() + 10 * 60_000;
    await sched({ action: 'create', items: items(phoneN(3)), atMs: at, kind: 'other' });
    goTo(at + 1000);
    const res = await call('/api/student/receipt', { body: { session: 'morning', phone: phoneN(3), receiptMessage: 'QAB999XYZ9 Confirmed. Ksh1,500.00 sent' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('refuses a time in the past, within 5 minutes, or more than 60 days ahead', async () => {
    await seed(phoneN(4));
    for (const atMs of [Date.now() - 1000, Date.now() + 60_000, Date.now() + 61 * 86_400_000]) {
      expect((await sched({ action: 'create', items: items(phoneN(4)), atMs, kind: 'other' })).status).toBe(400);
    }
  });
});

describe('the sweep applies a due schedule', () => {
  it('blocks, charges the fee AT that moment, clears the schedule, and leaves an Undo in Recent actions', async () => {
    await seed(phoneN(10));
    await seed(phoneN(11), { approvalStatus: 'pending' });
    await seed(phoneN(12), { blocked: true, blockReason: 'Earlier' });
    const at = Date.now() + 10 * 60_000;
    await sched({ action: 'create', items: items(phoneN(10), phoneN(11), phoneN(12)), atMs: at, kind: 'fees', amount: 1200 });

    expect((await sweep()).body.schedules ?? 0).toBe(0); // nothing due yet
    expect(await db.collection(`fees/accounts/items/${phoneN(10)}/ledger`).get()).toHaveProperty('size', 0);

    goTo(at + 30_000);
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ schedules: 1, blocked: 1, skipped: 2, finished: 1 });

    const s = await student(phoneN(10));
    expect(s).toMatchObject({ blocked: true, feeBalance: 1200 });
    expect(s.scheduledBlock).toBeUndefined();
    expect((await student(phoneN(11))).scheduledBlock).toBeUndefined();
    expect(await student(phoneN(12))).toMatchObject({ blockReason: 'Earlier' });

    const recent = await call('/api/students/bulk', { token: gold, body: { action: 'list' } });
    expect(recent.body.actions[0]).toMatchObject({ action: 'block', kind: 'fees', source: 'scheduled', counts: { done: 1 } });
    const undo = await call('/api/students/bulk', { token: gold, body: { action: 'undo', batchId: recent.body.actions[0].id } });
    expect(undo.body.undone).toBe(1);
    expect(await student(phoneN(10))).toMatchObject({ blocked: false, feeBalance: 0 });
    expect((await sched({ action: 'list' })).body.schedules).toEqual([]);
  });

  it('a big schedule is applied a chunk at a time, picking up where it left off', async () => {
    const phones = [];
    for (let i = 0; i < 30; i += 1) { phones.push(phoneN(100 + i)); await seed(phoneN(100 + i)); }
    const at = Date.now() + 10 * 60_000;
    const first = await sched({ action: 'create', items: items(...phones.slice(0, 25)), atMs: at, kind: 'other' });
    await sched({ action: 'create', items: items(...phones.slice(25)), atMs: at, kind: 'other', batchId: first.body.batchId });
    goTo(at + 1000);
    const res = await sweep();
    expect(res.body.blocked).toBe(30);
    for (const p of phones) expect((await student(p)).blocked).toBe(true);
  });
});

describe('paying before the time takes the student out', () => {
  it('a recorded payment, or an approved receipt, clears the schedule; the sweep then leaves them alone', async () => {
    await seed(phoneN(20));
    await seed(phoneN(21), { blocked: true, pendingReceipt: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending' });
    await seed(phoneN(22));
    const at = Date.now() + 10 * 60_000;
    await sched({ action: 'create', items: items(phoneN(20), phoneN(21), phoneN(22)), atMs: at, kind: 'other' });

    const paid = await call('/api/fees/post', { token: gold, body: { session: 'morning', phone: phoneN(20), type: 'payment', amount: 1500, method: 'mpesa', reference: 'QPAID00001' } });
    expect(paid.status).toBe(200);
    const approved = await call('/api/fees/approveReceipt', { token: gold, body: { session: 'morning', phone: phoneN(21) } });
    expect(approved.status).toBe(200);
    expect((await student(phoneN(20))).scheduledBlock).toBeUndefined();
    expect((await student(phoneN(21))).scheduledBlock).toBeUndefined();

    goTo(at + 1000);
    expect((await checkin(phoneN(20))).body.student.blocked).toBe(false);
    const res = await sweep();
    expect(res.body).toMatchObject({ blocked: 1, notScheduled: 2 });
    expect((await student(phoneN(20))).blocked).toBe(false);
    expect((await student(phoneN(22))).blocked).toBe(true);
  });
});

describe('list, reschedule, cancel, remove one', () => {
  it('lists this teacher\'s waiting schedules soonest first', async () => {
    await seed(phoneN(30));
    await seed(phoneN(31));
    const later = Date.now() + 2 * 86_400_000;
    const sooner = Date.now() + 86_400_000;
    await sched({ action: 'create', items: items(phoneN(30)), atMs: later, kind: 'other' });
    await sched({ action: 'create', items: items(phoneN(31)), atMs: sooner, kind: 'fees', amount: 900 });
    await sched({ action: 'create', items: items(phoneN(31)), atMs: sooner, kind: 'other' }, other);
    const res = await sched({ action: 'list' });
    expect(res.body.schedules.map((s) => s.atMs)).toEqual([sooner, later]);
    expect(res.body.schedules[0]).toMatchObject({ kind: 'fees', amount: 900, count: 1 });
  });

  it('a student scheduled twice is only in the newer schedule', async () => {
    await seed(phoneN(32));
    const a = await sched({ action: 'create', items: items(phoneN(32)), atMs: Date.now() + 86_400_000, kind: 'other' });
    const b = await sched({ action: 'create', items: items(phoneN(32)), atMs: Date.now() + 2 * 86_400_000, kind: 'other' });
    expect((await student(phoneN(32))).scheduledBlock.batchId).toBe(b.body.batchId);
    const member = (await db.doc(`scheduledBlocks/${a.body.batchId}/members/morning__${phoneN(32).slice(1)}`).get()).data();
    expect(member).toMatchObject({ status: 'removed', removedBecause: 'rescheduled' });
  });

  it('reschedule moves every member; cancel clears them all; removeMember clears one', async () => {
    for (const n of [40, 41, 42]) await seed(phoneN(n));
    const res = await sched({ action: 'create', items: items(phoneN(40), phoneN(41), phoneN(42)), atMs: Date.now() + 86_400_000, kind: 'other' });
    const id = res.body.batchId;
    const newAt = Date.now() + 3 * 86_400_000;
    expect((await sched({ action: 'reschedule', batchId: id, atMs: newAt })).status).toBe(200);
    expect((await student(phoneN(40))).scheduledBlock.atMs).toBe(newAt);

    expect((await sched({ action: 'removeMember', batchId: id, session: 'morning', phone: phoneN(41) })).status).toBe(200);
    expect((await student(phoneN(41))).scheduledBlock).toBeUndefined();
    expect((await sched({ action: 'list' })).body.schedules[0].count).toBe(2);

    expect((await sched({ action: 'cancel', batchId: id })).status).toBe(200);
    expect((await student(phoneN(40))).scheduledBlock).toBeUndefined();
    expect((await student(phoneN(42))).scheduledBlock).toBeUndefined();
    expect((await sched({ action: 'list' })).body.schedules).toEqual([]);
    expect((await sched({ action: 'cancel', batchId: id })).status).toBe(400);
  });

  it('another teacher cannot touch it; fee schedules need Silver and an amount', async () => {
    await seed(phoneN(50));
    const res = await sched({ action: 'create', items: items(phoneN(50)), atMs: Date.now() + 86_400_000, kind: 'other' });
    expect((await sched({ action: 'cancel', batchId: res.body.batchId }, other)).status).toBe(403);
    const bronze = await userWithClaims('fx003-sched-bronze', teacherClaims.bronze);
    expect((await sched({ action: 'create', items: items(phoneN(50)), atMs: Date.now() + 86_400_000, kind: 'fees', amount: 10 }, bronze)).status).toBe(403);
    expect((await sched({ action: 'create', items: items(phoneN(50)), atMs: Date.now() + 86_400_000, kind: 'fees' })).status).toBe(400);
  });
});

describe('batched ledger posting (postEntries)', () => {
  it('25 fee blocks in one call, each charged once, totals right, within the budget', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (r) => Number(/subreq;desc="(\d+)"/.exec(r.headers.get('server-timing'))[1]);
      const phones = [];
      for (let i = 0; i < 25; i += 1) { phones.push(phoneN(200 + i)); await seed(phoneN(200 + i)); }
      const res = await call('/api/students/bulk', { token: gold, body: { action: 'block', kind: 'fees', amount: 600, items: items(...phones) } });
      expect(res.body.done).toBe(25);
      // Measured 2026-10-29: 25 fee blocks = 10 subrequests (8 used to cost 30),
      // undo of 25 = 12, an idle sweep = 1.
      expect(subreq(res)).toBeLessThanOrEqual(15);
      expect((await db.doc('aggregates/dashboard').get()).data().totalOutstanding).toBe(15_000);
      for (const p of phones.slice(0, 3)) {
        expect((await student(p)).feeBalance).toBe(600);
        expect((await db.collection(`fees/accounts/items/${p}/ledger`).get()).size).toBe(1);
      }
      // A fee batch undoes 25 a call (its reversals are one transaction too).
      const undo = await call('/api/students/bulk', { token: gold, body: { action: 'undo', batchId: res.body.batchId } });
      expect(undo.body).toMatchObject({ undone: 25, remaining: false });
      expect(subreq(undo)).toBeLessThanOrEqual(15);
      expect((await db.doc('aggregates/dashboard').get()).data().totalOutstanding).toBe(0);
      expect((await student(phones[0])).feeBalance).toBe(0);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });

  it('the same number in two sessions in one chunk: its balance runs through both entries', async () => {
    await seed(phoneN(300));
    await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
    await db.doc(`sessions/evening/students/${phoneN(300)}`).set({
      studentName: 'Student', parentPhone: phoneN(300), class: 'Form 3', session: 'evening', blocked: false, approvalStatus: 'approved', feeBalance: 0,
    });
    const res = await call('/api/students/bulk', { token: gold, body: { action: 'block', kind: 'fees', amount: 500, items: [{ session: 'morning', phone: phoneN(300) }, { session: 'evening', phone: phoneN(300) }] } });
    expect(res.body.done).toBe(2);
    expect((await db.doc(`fees/accounts/items/${phoneN(300)}`).get()).data().balance).toBe(1000);
    expect((await db.doc(`sessions/evening/students/${phoneN(300)}`).get()).data().feeBalance).toBe(1000);
  });
});
