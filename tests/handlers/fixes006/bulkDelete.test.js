import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { existsSync, appendFileSync } from 'node:fs';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 006Fixes / 01 — bulk delete. Each student is removed exactly as the single
 * delete removes one (record, notes and activity gone; that registration's fee
 * account kept, marked deleted and any balance closed with the same entry),
 * the chunk batched so a call stays inside the Worker's subrequest budget.
 * The owner's confirmation (type DELETE) is enforced by the server too. No Undo.
 */

const phoneN = (n) => `+2547110${String(60000 + n).padStart(5, '0')}`;
let db; let teacher; let teacherB;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx006-del-a', teacherClaims.gold, { email: 'del.a@school.example' });
  teacherB = await userWithClaims('fx006-del-b', teacherClaims.gold, { email: 'del.b@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Grade 7', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'QX12345678 Confirmed. Ksh2,750.00 sent', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const bulk = (body, token = teacher) => call('/api/students/bulk', { token, body });
const del = (items, extra = {}) => bulk({ action: 'delete', confirm: 'DELETE', items, ...extra });
const student = async (s, p) => { const x = await db.doc(`sessions/${s}/students/${p}`).get(); return x.exists ? x.data() : null; };
const account = async (s, p) => (await db.doc(`fees/accounts/items/${s}__${p}`).get()).data() ?? null;
const ledger = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Grade 7', 'Grade 8'] });
});

describe('bulk delete removes each student exactly as the single delete does', () => {
  it('3 students: one owing 2,750, one with notes, one awaiting approval', async () => {
    const [owing, noted, waiting] = [phoneN(1), phoneN(2), phoneN(3)];
    await seed('morning', owing);
    await seed('morning', noted);
    await seed('morning', waiting, { approvalStatus: 'pending' });
    const charge = await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session: 'morning', phone: owing }] });
    expect(charge.status).toBe(200);
    await db.doc(`sessions/morning/students/${noted}/notes/n1`).set({ text: 'private', createdAt: new Date() });
    await db.doc(`sessions/morning/students/${noted}/notes/n2`).set({ text: 'private 2', createdAt: new Date() });
    expect(await outstanding()).toBe(2750);

    const res = await del([owing, noted, waiting].map((phone) => ({ session: 'morning', phone })));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: 3, skipped: {}, failed: [], balanceClosedTotal: 2750, balanceClosedCount: 1 });
    expect(res.body.undoUntilMs ?? null).toBeNull();

    for (const p of [owing, noted, waiting]) expect(await student('morning', p)).toBeNull();
    expect((await db.collection(`sessions/morning/students/${noted}/notes`).get()).size).toBe(0);
    // The fee account is kept as history, marked deleted, balance closed.
    const acc = await account('morning', owing);
    expect(acc).toMatchObject({ balance: 0, status: 'closed' });
    expect(acc.studentDeletedBy).toBe('fx006-del-a');
    const entries = await ledger('morning', owing);
    expect(entries.map((e) => e.type).sort()).toEqual(['adjustment', 'invoice']);
    const bulkClose = entries.find((e) => e.type === 'adjustment');
    expect(bulkClose).toMatchObject({ amount: -2750, magnitude: 2750, note: 'Balance closed: student deleted', balanceAfter: 0 });
    expect(await outstanding()).toBe(0);

    // The same entry the SINGLE delete posts (field for field, ids and times aside).
    const single = phoneN(4);
    await seed('morning', single);
    expect((await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session: 'morning', phone: single }] })).status).toBe(200);
    expect((await call('/api/student/remove', { token: teacher, body: { session: 'morning', phone: single } })).status).toBe(200);
    const singleClose = (await ledger('morning', single)).find((e) => e.type === 'adjustment');
    const comparable = (e) => {
      const { occurredAt, recordedAt, phone, ...rest } = e; // eslint-disable-line no-unused-vars
      return rest;
    };
    expect(comparable(bulkClose)).toEqual(comparable(singleClose));
    expect(await account('morning', single)).toMatchObject({ balance: 0, status: 'closed' });
    expect(Object.keys(await account('morning', owing)).sort()).toEqual(Object.keys(await account('morning', single)).sort());
    // A student is never re-created by the closing entry.
    expect(await student('morning', owing)).toBeNull();
  });

  it('a number in both sessions: deleting morning leaves evening and its balance alone', async () => {
    const p = phoneN(10);
    for (const s of ['morning', 'evening']) {
      await seed(s, p);
      expect((await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session: s, phone: p }] })).status).toBe(200);
    }
    const res = await del([{ session: 'morning', phone: p }]);
    expect(res.status).toBe(200);
    expect(await student('morning', p)).toBeNull();
    expect(await student('evening', p)).toMatchObject({ feeBalance: 2750, blocked: true });
    expect(await account('evening', p)).toMatchObject({ balance: 2750 });
    expect(await outstanding()).toBe(2750);
  });

  it('refuses without the typed confirmation, and deletes nothing', async () => {
    const p = phoneN(20);
    await seed('morning', p);
    for (const extra of [{ confirm: undefined }, { confirm: 'delete' }, { confirm: 'DELETE ' }, { confirm: 'yes' }]) {
      const body = { action: 'delete', items: [{ session: 'morning', phone: p }], ...extra };
      if (extra.confirm === undefined) delete body.confirm;
      expect((await bulk(body)).status).toBe(400);
    }
    expect(await student('morning', p)).not.toBeNull();
  });

  it('a student already gone is skipped as missing; a retried chunk closes nothing twice', async () => {
    const [p, gone] = [phoneN(30), phoneN(31)];
    await seed('morning', p);
    expect((await bulk({ action: 'block', kind: 'fees', amount: 1000, items: [{ session: 'morning', phone: p }] })).status).toBe(200);
    const first = await del([{ session: 'morning', phone: p }, { session: 'morning', phone: gone }]);
    expect(first.body).toMatchObject({ done: 1, skipped: { missing: 1 } });
    // The same chunk again (a retry after a lost reply), appended to the batch.
    const again = await del([{ session: 'morning', phone: p }], { batchId: first.body.batchId });
    expect(again.status).toBe(200);
    expect(again.body.done).toBe(1); // already done, counted, not repeated
    const closes = (await ledger('morning', p)).filter((e) => e.type === 'adjustment');
    expect(closes).toHaveLength(1);
  });

  it('cannot be undone; Recent actions lists it as not undoable', async () => {
    const p = phoneN(40);
    await seed('morning', p);
    const res = await del([{ session: 'morning', phone: p }]);
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe('not_undoable');
    const list = await bulk({ action: 'list' });
    expect(list.body.actions[0]).toMatchObject({ action: 'delete', undoable: false, counts: { done: 1 } });
    expect(list.body.limits.delete).toBeGreaterThan(0);
  });

  it('auth: signed out 401; any staff account may delete (004Fixes shared staff)', async () => {
    const p = phoneN(50);
    await seed('morning', p);
    expect((await call('/api/students/bulk', { body: { action: 'delete', confirm: 'DELETE', items: [{ session: 'morning', phone: p }] } })).status).toBe(401);
    expect((await del([{ session: 'morning', phone: p }].map((i) => i), {})).status).toBe(200);
    await seed('morning', p);
    expect((await bulk({ action: 'delete', confirm: 'DELETE', items: [{ session: 'morning', phone: p }] }, teacherB)).status).toBe(200);
    expect(await student('morning', p)).toBeNull();
  });

  it('refuses more than the per-call limit', async () => {
    const list = await bulk({ action: 'list' });
    const max = list.body.limits.delete;
    const items = Array.from({ length: max + 1 }, (_, i) => ({ session: 'morning', phone: phoneN(100 + i) }));
    expect((await del(items)).status).toBe(400);
  });

  it('a student in a waiting scheduled block leaves it: the schedule count drops and the sweep skips cleanly', async () => {
    const [a, b] = [phoneN(60), phoneN(61)];
    await seed('morning', a);
    await seed('morning', b);
    const at = Date.now() + 10 * 60_000;
    const sched = await call('/api/students/scheduled', { token: teacher, body: { action: 'create', atMs: at, kind: 'other', reason: 'r', items: [{ session: 'morning', phone: a }, { session: 'morning', phone: b }] } });
    expect(sched.status, JSON.stringify(sched.body)).toBe(200);
    const id = sched.body.batchId;
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().count).toBe(2);

    expect((await del([{ session: 'morning', phone: a }])).status).toBe(200);
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().count).toBe(1);
    const member = (await db.doc(`scheduledBlocks/${id}/members/morning__${a.replace(/\D/g, '')}`).get()).data();
    expect(member).toMatchObject({ status: 'removed', removedBecause: 'deleted' });
    const listed = await call('/api/students/scheduled', { token: teacher, body: { action: 'list' } });
    expect(listed.body.schedules.find((s) => s.id === id).count).toBe(1);
  });

  it('the single delete also takes the student out of a waiting schedule (same gap, same fix)', async () => {
    const a = phoneN(70);
    await seed('morning', a);
    const sched = await call('/api/students/scheduled', { token: teacher, body: { action: 'create', atMs: Date.now() + 10 * 60_000, kind: 'other', reason: 'r', items: [{ session: 'morning', phone: a }] } });
    const id = sched.body.batchId;
    expect((await call('/api/student/remove', { token: teacher, body: { session: 'morning', phone: a } })).status).toBe(200);
    expect((await db.doc(`scheduledBlocks/${id}`).get()).data().count).toBe(0);
  });

  it('stays inside the Worker budget at the per-call limit (every student owing, with notes)', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);
      const max = (await bulk({ action: 'list' })).body.limits.delete;
      const items = Array.from({ length: max }, (_, i) => ({ session: 'morning', phone: phoneN(200 + i) }));
      for (const i of items) {
        await seed('morning', i.phone);
        await db.doc(`sessions/morning/students/${i.phone}/notes/n1`).set({ text: 'x', createdAt: new Date() });
      }
      expect((await bulk({ action: 'block', kind: 'fees', amount: 500, items })).status).toBe(200);
      const t0 = Date.now();
      const res = await del(items);
      const ms = Date.now() - t0;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.done).toBe(max);
      expect(res.body.balanceClosedTotal).toBe(500 * max);
      // The Worker arms 45; 40 leaves room for a cold session-cache lookup.
      expect(subreq(res)).toBeLessThanOrEqual(40);
      // The measurement behind MAX_ITEMS.delete, kept with the plan when it exists.
      if (existsSync('issues/006Fixes/plan/logs')) {
        appendFileSync('issues/006Fixes/plan/logs/p01-delete-budget.txt', `${new Date().toISOString()} max ${max}: ${subreq(res)} subrequests, ${ms} ms (emulator)
`);
      }
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});
