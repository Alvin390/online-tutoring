import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 003Fixes / 04 — POST /api/students/bulk: block and unblock many students in
 * batched calls, with the skip rules on the server and a 30-minute undo.
 */

let db;
let gold;
let other;
let bronze;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('fx003-bulk-gold', teacherClaims.gold);
  other = await userWithClaims('fx003-bulk-other', teacherClaims.gold);
  bronze = await userWithClaims('fx003-bulk-bronze', teacherClaims.bronze);
});

beforeEach(async () => {
  await clearFirestore();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  await db.doc('sessions/evening').set({ slug: 'evening', name: 'Evening', active: true });
});

afterEach(() => vi.useRealTimers());

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: 'Student', parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'pending', feeBalance: 0, ...extra,
});
const student = async (session, phone) => (await db.doc(`sessions/${session}/students/${phone}`).get()).data();
const bulk = (body, token = gold) => call('/api/students/bulk', { body, token });
const items = (from, n, session = 'morning') => Array.from({ length: n }, (_, i) => ({ session, phone: phoneN(from + i) }));

describe('block, kind "other"', () => {
  it('blocks every student with exactly the fields the single block writes', async () => {
    for (let i = 0; i < 3; i += 1) await seed('morning', phoneN(100 + i));
    const res = await bulk({ action: 'block', kind: 'other', reason: 'Fees for next week', items: items(100, 3) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, done: 3, failed: [] });
    expect(res.body.batchId).toMatch(/^[A-Za-z0-9]+$/);
    expect(res.body.undoUntilMs).toBeGreaterThan(Date.now() + 29 * 60_000);
    const s = await student('morning', phoneN(100));
    expect(s).toMatchObject({ blocked: true, blockReason: 'Fees for next week', receiptStatus: 'expired' });
    expect(typeof s.blockedAt?.toMillis()).toBe('number');
    expect(JSON.stringify(res.body)).not.toContain(phoneN(100).slice(1));
  });

  it('skips students waiting for approval and students already blocked, and says how many', async () => {
    await seed('morning', phoneN(110));
    await seed('morning', phoneN(111), { approvalStatus: 'pending' });
    await seed('morning', phoneN(112), { blocked: true, blockReason: 'Earlier reason' });
    const res = await bulk({ action: 'block', kind: 'other', items: [...items(110, 3), { session: 'morning', phone: phoneN(119) }] });
    expect(res.body).toMatchObject({ done: 1, skipped: { awaitingApproval: 1, alreadyBlocked: 1, missing: 1 } });
    expect(await student('morning', phoneN(111))).toMatchObject({ blocked: false });
    expect(await student('morning', phoneN(112))).toMatchObject({ blockReason: 'Earlier reason' });
  });

  it('a chunk spread over several calls is one batch; a repeated call does nothing twice', async () => {
    for (let i = 0; i < 4; i += 1) await seed('morning', phoneN(120 + i));
    const first = await bulk({ action: 'block', kind: 'other', items: items(120, 2) });
    const second = await bulk({ action: 'block', kind: 'other', items: items(122, 2), batchId: first.body.batchId });
    expect(second.body.batchId).toBe(first.body.batchId);
    const again = await bulk({ action: 'block', kind: 'other', items: items(122, 2), batchId: first.body.batchId });
    expect(again.body).toMatchObject({ done: 2, skipped: {} });
    const batch = (await db.doc(`bulkActions/${first.body.batchId}`).get()).data();
    expect(batch.counts.done).toBe(4);
    expect((await db.collection(`bulkActions/${first.body.batchId}/items`).get()).size).toBe(4);
  });

  it('the same phone in two sessions: each session is its own item', async () => {
    await seed('morning', phoneN(130));
    await seed('evening', phoneN(130));
    const res = await bulk({ action: 'block', kind: 'other', items: [{ session: 'morning', phone: phoneN(130) }, { session: 'evening', phone: phoneN(130) }] });
    expect(res.body.done).toBe(2);
    expect((await student('evening', phoneN(130))).blocked).toBe(true);
  });
});

describe('block, kind "fees"', () => {
  it('charges each student first, then blocks; the balance shows on the record', async () => {
    for (let i = 0; i < 2; i += 1) await seed('morning', phoneN(200 + i));
    const res = await bulk({ action: 'block', kind: 'fees', amount: 1500, items: items(200, 2) });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(2);
    const s = await student('morning', phoneN(200));
    expect(s).toMatchObject({ blocked: true, blockReason: '', feeBalance: 1500 });
    const ledger = await db.collection(`fees/accounts/items/${phoneN(200)}/ledger`).get();
    expect(ledger.docs.map((d) => d.data().type)).toEqual(['invoice']);
    expect((await db.doc('aggregates/dashboard').get()).data().totalOutstanding).toBe(3000);
  });

  it('a retried fee chunk never charges twice', async () => {
    await seed('morning', phoneN(210));
    const first = await bulk({ action: 'block', kind: 'fees', amount: 900, items: items(210, 1) });
    // Simulate a lost response: the item mark is removed, the charge stays.
    await db.doc(`bulkActions/${first.body.batchId}/items/morning__${phoneN(210).slice(1)}`).delete();
    await db.doc(`sessions/morning/students/${phoneN(210)}`).set({ blocked: false }, { merge: true });
    await bulk({ action: 'block', kind: 'fees', amount: 900, items: items(210, 1), batchId: first.body.batchId });
    expect((await db.collection(`fees/accounts/items/${phoneN(210)}/ledger`).get()).size).toBe(1);
    expect((await student('morning', phoneN(210))).feeBalance).toBe(900);
  });

  it('needs Silver, fees switched on, and an amount', async () => {
    await seed('morning', phoneN(220));
    expect((await bulk({ action: 'block', kind: 'fees', amount: 100, items: items(220, 1) }, bronze)).status).toBe(403);
    expect((await bulk({ action: 'block', kind: 'fees', items: items(220, 1) })).status).toBe(400);
    await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': false });
    expect((await bulk({ action: 'block', kind: 'fees', amount: 100, items: items(220, 1) })).status).toBe(403);
    // A plain block is fine on Bronze.
    expect((await bulk({ action: 'block', kind: 'other', items: items(220, 1) }, bronze)).status).toBe(200);
  });
});

describe('unblock', () => {
  it('lifts the block with the single unblock\'s fields; not-blocked students are skipped', async () => {
    await seed('morning', phoneN(300), { blocked: true, blockReason: 'x', receiptStatus: 'expired', pendingReceipt: 'QZZ Confirmed' });
    await seed('morning', phoneN(301));
    const res = await bulk({ action: 'unblock', items: items(300, 2) });
    expect(res.body).toMatchObject({ done: 1, skipped: { notBlocked: 1 } });
    expect(await student('morning', phoneN(300))).toMatchObject({
      blocked: false, blockReason: '', blockedAt: null, receiptStatus: 'approved', pendingReceipt: null,
    });
  });
});

describe('undo', () => {
  it('a block: everyone back as they were, and fee charges reversed', async () => {
    await seed('morning', phoneN(400), { receiptStatus: 'approved' });
    await seed('morning', phoneN(401));
    const res = await bulk({ action: 'block', kind: 'fees', amount: 1200, items: items(400, 2) });
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.status).toBe(200);
    expect(undo.body).toMatchObject({ status: 'undone', remaining: false, undone: 2, changedSince: 0 });
    expect(await student('morning', phoneN(400))).toMatchObject({ blocked: false, receiptStatus: 'approved', feeBalance: 0 });
    expect((await db.doc('aggregates/dashboard').get()).data().totalOutstanding).toBe(0);
    expect((await db.doc(`bulkActions/${res.body.batchId}`).get()).data().status).toBe('undone');
  });

  it('a student who paid in the meantime is left alone and counted as changed', async () => {
    await seed('morning', phoneN(410));
    await seed('morning', phoneN(411));
    const res = await bulk({ action: 'block', kind: 'fees', amount: 800, items: items(410, 2) });
    const paid = await call('/api/fees/post', {
      body: { session: 'morning', phone: phoneN(410), type: 'payment', amount: 800, method: 'mpesa', reference: 'QPAID00001' },
      token: gold,
    });
    expect(paid.body.unblocked).toBe(true);
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.body).toMatchObject({ undone: 1, changedSince: 1 });
    expect(await student('morning', phoneN(410))).toMatchObject({ blocked: false, feeBalance: 0 });
    expect((await db.collection(`fees/accounts/items/${phoneN(410)}/ledger`).get()).size).toBe(2);
  });

  it('an unblock: re-blocked with the old reason', async () => {
    await seed('morning', phoneN(420), { blocked: true, blockReason: 'Unpaid term', receiptStatus: 'expired' });
    const res = await bulk({ action: 'unblock', items: items(420, 1) });
    await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(await student('morning', phoneN(420))).toMatchObject({ blocked: true, blockReason: 'Unpaid term', receiptStatus: 'expired' });
  });

  it('only the teacher who did it; a second undo changes nothing; after 30 minutes it is too late', async () => {
    await seed('morning', phoneN(430));
    const res = await bulk({ action: 'block', kind: 'other', items: items(430, 1) });
    expect((await bulk({ action: 'undo', batchId: res.body.batchId }, other)).status).toBe(403);

    const first = await bulk({ action: 'undo', batchId: res.body.batchId });
    const second = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(first.body.undone).toBe(1);
    expect(second.body).toMatchObject({ status: 'undone', undone: 0 });

    await seed('morning', phoneN(431));
    const late = await bulk({ action: 'block', kind: 'other', items: items(431, 1) });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const expired = await bulk({ action: 'undo', batchId: late.body.batchId });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('undo_expired');
  });

  it('a big batch undoes in chunks (remaining until done)', async () => {
    for (let i = 0; i < 25; i += 1) await seed('morning', phoneN(500 + i));
    const res = await bulk({ action: 'block', kind: 'other', items: items(500, 25) });
    const a = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(a.body).toMatchObject({ remaining: true, undone: 20 });
    const b = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(b.body).toMatchObject({ remaining: false, undone: 5, status: 'undone' });
  });
});

describe('list, validation and cost', () => {
  it('lists this teacher\'s actions from the last 30 minutes, with the chunk sizes', async () => {
    await seed('morning', phoneN(600));
    await bulk({ action: 'block', kind: 'other', reason: 'r', items: items(600, 1) });
    await bulk({ action: 'block', kind: 'other', items: items(600, 1) }, other);
    const res = await bulk({ action: 'list' });
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0]).toMatchObject({ action: 'block', kind: 'other', status: 'done', counts: { done: 1 } });
    expect(res.body.limits).toMatchObject({ block: 25, blockFees: 8, unblock: 25 });
  });

  it('refuses 26 students, an unknown session, a missing token', async () => {
    expect((await bulk({ action: 'block', kind: 'other', items: items(700, 26) })).status).toBe(400);
    expect((await bulk({ action: 'block', kind: 'fees', amount: 10, items: items(700, 9) })).status).toBe(400);
    expect((await bulk({ action: 'block', kind: 'other', items: [{ session: 'nosuch', phone: phoneN(700) }] })).status).toBe(404);
    expect((await call('/api/students/bulk', { body: { action: 'list' } })).status).toBe(401);
  });

  it('stays within the Worker budget: 25 plain blocks and 8 fee blocks per call', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);
      for (let i = 0; i < 25; i += 1) await seed('morning', phoneN(800 + i));
      for (let i = 0; i < 8; i += 1) await seed('morning', phoneN(850 + i));
      const plain = await bulk({ action: 'block', kind: 'other', items: items(800, 25) });
      const fees = await bulk({ action: 'block', kind: 'fees', amount: 500, items: items(850, 8) });
      const undoFees = await bulk({ action: 'undo', batchId: fees.body.batchId });
      // Measured 2026-10-28: plain ×25 = 6, fees ×8 = 30, undo of 6 fee items = 36
      // (the budget is 45; 40 leaves room for a cold session-cache lookup).
      expect(subreq(plain)).toBeLessThanOrEqual(10);
      expect(subreq(fees)).toBeLessThanOrEqual(40);
      expect(subreq(undoFees)).toBeLessThanOrEqual(40);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});
