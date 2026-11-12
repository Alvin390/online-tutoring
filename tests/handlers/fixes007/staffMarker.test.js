import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, appendFileSync } from 'node:fs';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 007Fixes / 07 — the staff marker (owner, 2026-11-11): a registration can be
 * marked as staff. Marking lets them in for good (approved, unblocked, out of
 * any waiting schedule, no duplicate hold, no pending receipt) and closes any
 * balance with one "Staff, no fee" adjustment. Unmarking only removes the
 * marker. The marker is server-owned (rules); this is the only way to set it.
 */

const phoneN = (n) => `+2547120${String(70000 + n).padStart(5, '0')}`;
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx007-staff-a', teacherClaims.gold, { email: 'staff.a@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Teacher ${phone.slice(-3)}`, parentPhone: phone, class: 'Grade 7', subjects: 'English, Mathematics',
  receiptMessage: 'Focus online staff', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const staffCall = (body, token = teacher) => call('/api/students/staff', { token, body });
const mark = (items, extra = {}) => staffCall({ action: 'mark', items, opId: extra.opId ?? `op${Date.now()}${Math.floor(Math.random() * 1e6)}`, ...extra });
const unmark = (items) => staffCall({ action: 'unmark', items });
const bulk = (body) => call('/api/students/bulk', { token: teacher, body });
const student = async (s, p) => { const x = await db.doc(`sessions/${s}/students/${p}`).get(); return x.exists ? x.data() : null; };
const ledger = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;
const charge = async (session, phone, amount) => {
  const res = await bulk({ action: 'block', kind: 'fees', amount, items: [{ session, phone }] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Grade 7', 'Grade 8'] });
});

describe('marking a registration as staff', () => {
  it('sets the marker and lets them in: approved, unblocked, no hold, no pending receipt, no partial marker', async () => {
    const [pending, blocked, held, receipt] = [phoneN(1), phoneN(2), phoneN(3), phoneN(4)];
    await seed('evening', pending, { approvalStatus: 'pending' });
    await seed('evening', blocked, { blocked: true, blockReason: 'See the teacher', blockedAt: new Date() });
    await seed('evening', held, { approvalStatus: 'pending', duplicateHold: true, duplicateOf: '+254700000001' });
    await seed('evening', receipt, { pendingReceipt: 'QX99 Confirmed', receiptStatus: 'pending', partialPayment: { paid: 500 } });

    const res = await mark([pending, blocked, held, receipt].map((phone) => ({ session: 'evening', phone })));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ marked: 4, closedBalances: [], skipped: [] });

    for (const p of [pending, blocked, held, receipt]) {
      const s = await student('evening', p);
      expect(s.staff).toBe(true);
      expect(s.staffBy).toBe('fx007-staff-a');
      expect(s.staffAt).toBeTruthy();
      expect(s.approvalStatus).toBe('approved');
      expect(s.blocked).toBe(false);
      expect(s.blockReason).toBe('');
      expect(s.duplicateHold).toBeUndefined();
      expect(s.duplicateOf).toBeUndefined();
      expect(s.pendingReceipt ?? null).toBeNull();
      expect(s.receiptStatus).toBe('approved');
      expect(s.partialPayment).toBeUndefined();
    }
    const approved = await student('evening', pending);
    expect(approved.approvedBy).toBe('fx007-staff-a');
    expect(approved.approvedAt).toBeTruthy();
  });

  it('a rejected registration is let in too (the teacher has decided they are staff)', async () => {
    const p = phoneN(5);
    await seed('morning', p, { approvalStatus: 'rejected', rejectionReason: 'Unknown payment' });
    expect((await mark([{ session: 'morning', phone: p }])).body.marked).toBe(1);
    expect(await student('morning', p)).toMatchObject({ staff: true, approvalStatus: 'approved' });
  });

  it('leaves a waiting scheduled block: off the schedule, and the schedule counts one fewer', async () => {
    const [a, b] = [phoneN(6), phoneN(7)];
    const atMs = Date.now() + 86_400_000;
    await db.doc('scheduledBlocks/S1').set({ status: 'scheduled', count: 2, kind: 'fees', amount: 2750, atMs, dueAtMs: atMs });
    for (const p of [a, b]) {
      await seed('evening', p, { scheduledBlock: { batchId: 'S1', atMs, kind: 'fees', amount: 2750 } });
      await db.doc(`scheduledBlocks/S1/members/evening__${p.replace(/\D/g, '')}`).set({ session: 'evening', phone: p, status: 'scheduled' });
    }
    expect((await mark([{ session: 'evening', phone: a }])).body.marked).toBe(1);
    expect((await student('evening', a)).scheduledBlock).toBeUndefined();
    expect((await db.doc(`scheduledBlocks/S1/members/evening__${a.replace(/\D/g, '')}`).get()).data())
      .toMatchObject({ status: 'removed', removedBecause: 'staff' });
    expect((await db.doc('scheduledBlocks/S1').get()).data().count).toBe(1);
    // The other student is still on it.
    expect((await student('evening', b)).scheduledBlock.batchId).toBe('S1');
  });
});

describe('the balance is closed', () => {
  it('2,750 owed: one "Staff, no fee" adjustment, Total outstanding drops by 2,750', async () => {
    const p = phoneN(10);
    await seed('evening', p);
    await charge('evening', p, 2750);
    expect(await outstanding()).toBe(2750);

    const res = await mark([{ session: 'evening', phone: p }]);
    expect(res.body.closedBalances).toEqual([{ session: 'evening', amount: 2750 }]);
    const close = (await ledger('evening', p)).filter((e) => e.type === 'adjustment');
    expect(close).toHaveLength(1);
    expect(close[0]).toMatchObject({ amount: -2750, magnitude: 2750, note: 'Staff, no fee', balanceAfter: 0 });
    expect((await student('evening', p)).feeBalance).toBe(0);
    expect(await outstanding()).toBe(0);
  });

  it('nothing owed: no ledger entry at all', async () => {
    const p = phoneN(11);
    await seed('evening', p);
    await mark([{ session: 'evening', phone: p }]);
    expect(await ledger('evening', p)).toEqual([]);
  });

  it('a student in credit keeps the credit (only a debt is closed)', async () => {
    const p = phoneN(12);
    await seed('evening', p);
    await db.doc(`fees/accounts/items/evening__${p}`).set({ key: `evening__${p}`, phone: p, session: 'evening', balance: -500 });
    const res = await mark([{ session: 'evening', phone: p }]);
    expect(res.body.closedBalances).toEqual([]);
    expect(await ledger('evening', p)).toEqual([]);
  });

  it('a retry of the same operation never closes twice', async () => {
    const p = phoneN(13);
    await seed('evening', p);
    await charge('evening', p, 1000);
    await mark([{ session: 'evening', phone: p }], { opId: 'retry1' });
    // The marker write is undone by hand, as if the first call had failed after the ledger.
    await db.doc(`sessions/evening/students/${p}`).update({ staff: null });
    await db.doc(`sessions/evening/students/${p}`).set({ feeBalance: 0 }, { merge: true });
    const again = await mark([{ session: 'evening', phone: p }], { opId: 'retry1' });
    expect(again.status).toBe(200);
    expect((await ledger('evening', p)).filter((e) => e.type === 'adjustment')).toHaveLength(1);
    expect(await outstanding()).toBe(0);
  });

  it('marked, unmarked, charged again, marked again: the new debt is closed too', async () => {
    const p = phoneN(14);
    await seed('evening', p);
    await charge('evening', p, 1000);
    await mark([{ session: 'evening', phone: p }]);
    await unmark([{ session: 'evening', phone: p }]);
    // Back to student: a later block charges as usual.
    await bulk({ action: 'unblock', items: [{ session: 'evening', phone: p }] });
    await charge('evening', p, 2750);
    expect(await outstanding()).toBe(2750);
    const res = await mark([{ session: 'evening', phone: p }]);
    expect(res.body.closedBalances).toEqual([{ session: 'evening', amount: 2750 }]);
    expect((await ledger('evening', p)).filter((e) => e.type === 'adjustment')).toHaveLength(2);
    expect(await outstanding()).toBe(0);
  });
});

describe('the same number in the other session', () => {
  it('alsoOtherSession marks the evening record too, each balance closed on its own account', async () => {
    const p = phoneN(20);
    await seed('morning', p);
    await seed('evening', p);
    await charge('morning', p, 2750);
    await charge('evening', p, 1500);
    const res = await mark([{ session: 'morning', phone: p }], { alsoOtherSession: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.marked).toBe(2);
    expect(res.body.closedBalances).toEqual(expect.arrayContaining([
      { session: 'morning', amount: 2750 }, { session: 'evening', amount: 1500 },
    ]));
    expect((await student('evening', p)).staff).toBe(true);
    expect(await outstanding()).toBe(0);
  });

  it('both records named AND alsoOtherSession: each marked once', async () => {
    const p = phoneN(21);
    await seed('morning', p);
    await seed('evening', p);
    await charge('evening', p, 500);
    const res = await mark([{ session: 'morning', phone: p }, { session: 'evening', phone: p }], { alsoOtherSession: true });
    expect(res.body).toMatchObject({ marked: 2, skipped: [] });
    expect((await ledger('evening', p)).filter((e) => e.type === 'adjustment')).toHaveLength(1);
  });

  it('without alsoOtherSession the other record is left alone', async () => {
    const p = phoneN(22);
    await seed('morning', p);
    await seed('evening', p);
    await mark([{ session: 'morning', phone: p }]);
    expect((await student('evening', p)).staff).toBeUndefined();
  });

  it('no record in the other session: nothing to add, nothing reported missing', async () => {
    const p = phoneN(23);
    await seed('morning', p);
    const res = await mark([{ session: 'morning', phone: p }], { alsoOtherSession: true });
    expect(res.body).toMatchObject({ marked: 1, skipped: [] });
  });
});

describe('unmarking, skips and refusals', () => {
  it('unmark removes only the marker: approval, block state and the closed balance stay', async () => {
    const p = phoneN(30);
    await seed('evening', p);
    await charge('evening', p, 2750);
    await mark([{ session: 'evening', phone: p }]);
    const res = await unmark([{ session: 'evening', phone: p }]);
    expect(res.body).toMatchObject({ unmarked: 1, skipped: [] });
    const s = await student('evening', p);
    expect(s.staff).toBeUndefined();
    expect(s.staffAt).toBeUndefined();
    expect(s.staffBy).toBeUndefined();
    expect(s).toMatchObject({ approvalStatus: 'approved', blocked: false, feeBalance: 0 });
    expect(await outstanding()).toBe(0);
  });

  it('already staff, missing, and not staff are reported as skipped (by index, no phone)', async () => {
    const [staff, plain] = [phoneN(31), phoneN(32)];
    await seed('evening', staff, { staff: true });
    await seed('evening', plain);
    const m = await mark([{ session: 'evening', phone: staff }, { session: 'evening', phone: phoneN(33) }]);
    expect(m.body).toMatchObject({ marked: 0, skipped: [{ index: 0, reason: 'alreadyStaff' }, { index: 1, reason: 'missing' }] });
    const u = await unmark([{ session: 'evening', phone: plain }]);
    expect(u.body).toMatchObject({ unmarked: 0, skipped: [{ index: 0, reason: 'notStaff' }] });
    expect(JSON.stringify(m.body) + JSON.stringify(u.body)).not.toMatch(/\+2547/);
  });

  it('signed out: 401; a session that does not exist: 404; a chunk over the limit: 400', async () => {
    const p = phoneN(34);
    await seed('evening', p);
    expect((await call('/api/students/staff', { body: { action: 'mark', items: [{ session: 'evening', phone: p }], opId: 'x1' } })).status).toBe(401);
    expect((await mark([{ session: 'nosuch', phone: p }])).status).toBe(404);
    const tooMany = Array.from({ length: 26 }, (_, i) => ({ session: 'evening', phone: phoneN(100 + i) }));
    expect((await mark(tooMany)).status).toBe(400);
  });

  it('writes an audit line with counts and the total closed (no phones)', async () => {
    const p = phoneN(35);
    await seed('evening', p);
    await charge('evening', p, 2750);
    await mark([{ session: 'evening', phone: p }]);
    await unmark([{ session: 'evening', phone: p }]);
    const audit = (await db.collection('audit').get()).docs.map((d) => d.data());
    const marked = audit.find((a) => a.action === 'students.staff_marked');
    const unmarked = audit.find((a) => a.action === 'students.staff_unmarked');
    expect(marked).toBeTruthy();
    expect(unmarked).toBeTruthy();
    expect(marked.after).toMatchObject({ count: 1, sessions: ['evening'], closedTotal: 2750 });
    expect(JSON.stringify(marked) + JSON.stringify(unmarked)).not.toMatch(/\+2547/);
  });

  it('a phone change carries the marker to the new number', async () => {
    const [from, to] = [phoneN(36), phoneN(37)];
    await seed('evening', from);
    await mark([{ session: 'evening', phone: from }]);
    const res = await call('/api/student/update', { token: teacher, body: { session: 'evening', phone: from, newPhone: to, changes: {} } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await student('evening', to)).toMatchObject({ staff: true, staffBy: 'fx007-staff-a' });
  });
});

describe('the subrequest budget', () => {
  it('a full chunk, each owing and with the other session too, stays inside the Worker budget', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);
      const max = 25;
      const items = Array.from({ length: max }, (_, i) => ({ session: 'morning', phone: phoneN(200 + i) }));
      for (const i of items) {
        await seed('morning', i.phone);
        await seed('evening', i.phone);
      }
      expect((await bulk({ action: 'block', kind: 'fees', amount: 500, items })).status).toBe(200);
      expect((await bulk({ action: 'block', kind: 'fees', amount: 500, items: items.map((i) => ({ ...i, session: 'evening' })) })).status).toBe(200);
      const t0 = Date.now();
      const res = await mark(items, { alsoOtherSession: true });
      const ms = Date.now() - t0;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.marked).toBe(2 * max);
      expect(await outstanding()).toBe(0);
      // The Worker arms 45; 40 leaves room for a cold session-cache lookup.
      expect(subreq(res)).toBeLessThanOrEqual(40);
      if (existsSync('issues/007Fixes/plan/logs')) {
        appendFileSync('issues/007Fixes/plan/logs/p07-staff-budget.txt', `${new Date().toISOString()} ${max} items + other session (${2 * max} records, all owing): ${subreq(res)} subrequests, ${ms} ms (emulator)\n`);
      }
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});
