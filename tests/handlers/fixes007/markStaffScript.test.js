import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims } from '../_worker.js';

/**
 * 007Fixes / 11 — mark the teachers the owner confirmed (21 people, 29
 * records, 2026-11-12). The script marks through the SAME library as the
 * dashboard (api/_lib/staff.js). Dry run by default; apply only with a backup;
 * idempotent; restore reverses the closures through the ledger (append-only)
 * and puts each record and schedule place back.
 */

const P = (n) => `+2547140${String(90000 + n).padStart(5, '0')}`;
let db; let teacher; let lib; let dir;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx007-script-teacher', teacherClaims.gold, { email: 'script@school.example' });
  lib = await import('../../../scripts/lib/markStaffConfirmed.mjs');
  dir = mkdtempSync(path.join(tmpdir(), 'fx007-staff-'));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Teacher ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English',
  receiptMessage: 'Focus online staff', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const student = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const ledger = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;
const [A, B, C, D] = [P(1), P(2), P(3), P(4)];
const targets = [
  { session: 'evening', phone: A }, // owes 2,750 and is blocked for it
  { session: 'morning', phone: B }, // plain, on a waiting schedule
  { session: 'evening', phone: C }, // already staff
  { session: 'evening', phone: D }, // gone (deleted since the list)
];

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
  await seed('evening', A);
  const res = await call('/api/students/bulk', { token: teacher, body: { action: 'block', kind: 'fees', amount: 2750, items: [{ session: 'evening', phone: A }] } });
  expect(res.status).toBe(200);
  const atMs = Date.now() + 86_400_000;
  await db.doc('scheduledBlocks/S9').set({ status: 'scheduled', count: 1, kind: 'other', reason: 'x', atMs, dueAtMs: atMs });
  await seed('morning', B, { scheduledBlock: { batchId: 'S9', atMs, kind: 'other' } });
  await db.doc(`scheduledBlocks/S9/members/morning__${B.replace(/\D/g, '')}`).set({ session: 'morning', phone: B, status: 'scheduled' });
  await seed('evening', C, { staff: true, staffBy: 'earlier' });
});

describe('dry run', () => {
  it('counts what would happen and writes nothing; no names or numbers in the report', async () => {
    const report = await lib.planMarkStaff(db, targets);
    expect(report).toMatchObject({
      targets: 4, toMark: 2, alreadyStaff: 1, missing: 1, balancesToClose: 1, totalToClose: 2750,
      bySession: { evening: { toMark: 1, totalToClose: 2750 }, morning: { toMark: 1, totalToClose: 0 } },
    });
    expect(JSON.stringify(report)).not.toMatch(/\+2547|Teacher /);
    expect((await student('evening', A)).staff).toBeUndefined();
    expect(await outstanding()).toBe(2750);
  });
});

describe('apply, re-apply, restore', () => {
  it('apply needs a backup file', async () => {
    await expect(lib.applyMarkStaff(db, targets, {})).rejects.toThrow(/backup/);
  });

  it('marks through the dashboard library, closes the debt, writes a backup and an audit line', async () => {
    const backupFile = path.join(dir, 'apply.json');
    const result = await lib.applyMarkStaff(db, targets, { backupFile });
    expect(result).toMatchObject({ marked: 2, closedTotal: 2750, alreadyStaff: 1, missing: 1 });
    expect(existsSync(backupFile)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/\+2547/);

    const a = await student('evening', A);
    expect(a).toMatchObject({ staff: true, staffBy: 'system:script:007Fixes', blocked: false, feeBalance: 0 });
    const close = (await ledger('evening', A)).find((e) => e.type === 'adjustment');
    expect(close).toMatchObject({ note: 'Staff, no fee', amount: -2750, recordedBy: 'system:script:007Fixes' });
    expect(await outstanding()).toBe(0);
    const b = await student('morning', B);
    expect(b.staff).toBe(true);
    expect(b.scheduledBlock).toBeUndefined();
    expect((await db.doc('scheduledBlocks/S9').get()).data().count).toBe(0);

    const audit = (await db.collection('audit').get()).docs.map((d) => d.data()).find((x) => x.action === 'students.staff_marked');
    expect(audit).toMatchObject({ actor: 'system:script:007Fixes' });
    expect(audit.after).toMatchObject({ count: 2, closedTotal: 2750 });

    // Re-apply: nothing more to do.
    const again = await lib.applyMarkStaff(db, targets, { backupFile: path.join(dir, 'again.json') });
    expect(again).toMatchObject({ marked: 0, alreadyStaff: 3, missing: 1, closedTotal: 0 });
    expect((await ledger('evening', A)).filter((e) => e.type === 'adjustment')).toHaveLength(1);
  });

  it('restore puts the records and the schedule place back and reverses the closure in the ledger', async () => {
    const backupFile = path.join(dir, 'restore.json');
    await lib.applyMarkStaff(db, targets, { backupFile });
    const restored = await lib.restoreMarkStaff(db, backupFile);
    expect(restored).toMatchObject({ records: 2, reversed: 1, schedulesRejoined: 1 });

    const a = await student('evening', A);
    expect(a.staff).toBeUndefined();
    expect(a).toMatchObject({ blocked: true, feeBalance: 2750 });
    const entries = await ledger('evening', A);
    expect(entries.map((e) => e.type).sort()).toEqual(['adjustment', 'invoice', 'reversal']);
    expect(await outstanding()).toBe(2750);

    const b = await student('morning', B);
    expect(b.staff).toBeUndefined();
    expect(b.scheduledBlock.batchId).toBe('S9');
    expect((await db.doc(`scheduledBlocks/S9/members/morning__${B.replace(/\D/g, '')}`).get()).data().status).toBe('scheduled');
    expect((await db.doc('scheduledBlocks/S9').get()).data().count).toBe(1);
    // C was staff before the script and stays staff.
    expect((await student('evening', C)).staff).toBe(true);
    // The backup file holds the records, nothing else needed to restore.
    expect(JSON.parse(readFileSync(backupFile, 'utf8')).records).toHaveLength(2);
  });
});
