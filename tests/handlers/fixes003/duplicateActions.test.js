import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 003Fixes / 12 — the teacher settles a duplicate: Decline (remove it, retire
 * the number), Merge (notes and money move to the kept record, the removed
 * number is retired and told which number to use), Keep both (never flagged
 * again), and Allow a retired number again. A retired number is told exactly
 * what to do at check-in and registration.
 */

let db;
let teacher;
const KEEP = phoneN(7678);
const DUP = phoneN(7679);
const RECEIPT = 'QX12345678 Confirmed. Ksh1,000.00 sent to TEACHER';

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx003-dup-actions', teacherClaims.gold);
});

const seed = (phone, extra = {}) => db.doc(`sessions/morning/students/${phone}`).set({
  studentName: 'Amina Wanjiru', parentPhone: phone, class: 'Grade 7', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: RECEIPT, registeredAt: new Date('2026-10-01T06:00:00Z'), session: 'morning',
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'pending', feeBalance: 0, ...extra,
});
const note = (phone, id, text) => db.doc(`sessions/morning/students/${phone}/notes/${id}`).set({
  text, authorUid: 'teacher-x', createdAt: new Date('2026-10-05T08:00:00Z'),
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true, classes: ['Grade 7', 'Grade 8'] });
  await seed(KEEP, { lastAccessed: new Date('2026-10-20T06:00:00Z') });
  await seed(DUP, { approvalStatus: 'pending', duplicateHold: true, duplicateOf: KEEP, pendingReceipt: 'RZ11112222 Confirmed', lastAccessed: new Date('2026-10-25T06:00:00Z') });
});

const act = (body) => call('/api/students/duplicates', { token: teacher, body: { session: 'morning', ...body } });
const stored = async (phone) => {
  const snap = await db.doc(`sessions/morning/students/${phone}`).get();
  return snap.exists ? snap.data() : null;
};
const retired = async (phone) => (await db.doc(`sessions/morning/retiredNumbers/${phone}`).get()).data() ?? null;
const notes = async (phone) => (await db.collection(`sessions/morning/students/${phone}/notes`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const checkin = (phone) => call('/api/student/checkin', { body: { session: 'morning', phone } });
const register = (phone) => call('/api/student/register', {
  body: { session: 'morning', phone, studentName: 'Brian Otieno', class: 'Grade 8', subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: 'AB12345678 Confirmed. paid' },
});
const owe = async (phone, amount) => {
  const res = await call('/api/fees/post', { token: teacher, body: { session: 'morning', phone, type: 'invoice', amount } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;
const balance = async (phone) => (await db.doc(`fees/accounts/items/${phone}`).get()).data()?.balance ?? 0;
const subreq = (res) => Number(/subreq;desc="(\d+)"/.exec(res.headers.get('server-timing'))[1]);

describe('decline', () => {
  it('removes the record and its notes, retires the number; check-in and register are told; allowNumber lifts it', async () => {
    await note(DUP, 'n1', 'paid twice?');
    const res = await act({ action: 'decline', phone: DUP });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Amina/);
    expect(await stored(DUP)).toBeNull();
    expect(await notes(DUP)).toHaveLength(0);
    expect(await retired(DUP)).toMatchObject({ reason: 'duplicate' });

    const check = await checkin(DUP);
    expect(check.body).toMatchObject({ exists: false, student: null, retired: 'duplicate' });
    expect(check.body.keptSuffix).toBeUndefined();

    const again = await register(DUP);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('retired_number');
    expect(again.body.error.message).toMatch(/registered twice/);

    expect((await act({ action: 'allowNumber', phone: DUP })).status).toBe(200);
    expect(await retired(DUP)).toBeNull();
    expect((await register(DUP)).status).toBe(200);
  });
});

describe('merge', () => {
  it('notes and money move to the kept record; totals unchanged; the removed number is retired with the kept suffix only', async () => {
    await note(KEEP, 'k1', 'kept note');
    await note(DUP, 'd1', 'from the duplicate');
    await note(DUP, 'd2', 'second');
    await owe(KEEP, 300);
    await owe(DUP, 500);
    const totalBefore = await outstanding();
    expect(totalBefore).toBe(800);

    const res = await act({ action: 'merge', keep: KEEP, remove: DUP });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, done: true, notesMoved: 2, balanceMoved: 500 });

    const kept = await stored(KEEP);
    expect((await notes(KEEP)).map((n) => n.id).sort()).toEqual(['d1', 'd2', 'k1']);
    expect((await notes(KEEP)).find((n) => n.id === 'd1')).toMatchObject({ text: 'from the duplicate', authorUid: 'teacher-x' });
    expect(await balance(KEEP)).toBe(800);
    expect(kept.feeBalance).toBe(800);
    expect(await outstanding()).toBe(totalBefore);
    // Only what the kept record lacked: its pending receipt, and the later last check-in.
    expect(kept.pendingReceipt).toBe('RZ11112222 Confirmed');
    expect(kept.lastAccessed.toDate().toISOString()).toBe('2026-10-25T06:00:00.000Z');
    expect(kept.approvalStatus).toBe('approved');

    expect(await stored(DUP)).toBeNull();
    expect(await balance(DUP)).toBe(0);
    expect(await retired(DUP)).toMatchObject({ reason: 'merged', keptSuffix: '678' });

    const check = await checkin(DUP);
    expect(check.body).toMatchObject({ exists: false, retired: 'merged', keptSuffix: '678' });
    expect(JSON.stringify(check.body)).not.toContain(KEEP);
    expect((await register(DUP)).body.error.message).toMatch(/ending …678/);
  });

  it('repeating a merge gives the same result and moves nothing twice', async () => {
    await note(DUP, 'd1', 'once');
    await owe(DUP, 500);
    const first = await act({ action: 'merge', keep: KEEP, remove: DUP });
    const second = await act({ action: 'merge', keep: KEEP, remove: DUP });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, done: true, alreadyMerged: true });
    expect(first.body.done).toBe(true);
    expect(await balance(KEEP)).toBe(500);
    expect(await notes(KEEP)).toHaveLength(1);
  });

  it('a large note set moves over several calls with a cursor', async () => {
    const batch = db.batch();
    for (let i = 0; i < 250; i += 1) batch.set(db.doc(`sessions/morning/students/${DUP}/notes/n${String(i).padStart(3, '0')}`), { text: `note ${i}`, authorUid: 't', createdAt: new Date() });
    await batch.commit();
    let res = await act({ action: 'merge', keep: KEEP, remove: DUP });
    expect(res.body.done).toBe(false);
    expect(res.body.cursor).toBeTruthy();
    let calls = 1;
    while (!res.body.done && calls < 5) {
      res = await act({ action: 'merge', keep: KEEP, remove: DUP, cursor: res.body.cursor });
      calls += 1;
    }
    expect(res.body.done).toBe(true);
    expect(await notes(KEEP)).toHaveLength(250);
    expect(await stored(DUP)).toBeNull();
  });

  it('refuses keep = remove (400) and a missing record (404)', async () => {
    expect((await act({ action: 'merge', keep: KEEP, remove: KEEP })).status).toBe(400);
    expect((await act({ action: 'merge', keep: KEEP, remove: phoneN(7999) })).status).toBe(404);
    expect((await act({ action: 'decline', phone: phoneN(7999) })).status).toBe(404);
  });
});

describe('keepBoth', () => {
  it('each lists the other; the hold and the link between them are cleared; a re-registration against the pair is not held', async () => {
    const res = await act({ action: 'keepBoth', a: KEEP, b: DUP });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [a, b] = [await stored(KEEP), await stored(DUP)];
    expect(a.duplicateKeep).toEqual([DUP]);
    expect(b.duplicateKeep).toEqual([KEEP]);
    expect(b.duplicateHold).toBeUndefined();
    expect(b.duplicateOf).toBeUndefined();
    const { isDuplicatePair } = await import('../../../api/_lib/duplicates.js');
    expect(isDuplicatePair(a, b)).toBe(false);
  });
});

describe('access and cost', () => {
  it('teacher only', async () => {
    expect((await call('/api/students/duplicates', { body: { session: 'morning', action: 'decline', phone: DUP } })).status).toBe(401);
  });

  it('an ordinary check-in costs no more than before; a merge stays well inside the budget', async () => {
    process.env.PERF_TIMING = '1';
    try {
      const found = await checkin(KEEP);
      const missing = await checkin(phoneN(7998));
      await note(DUP, 'd1', 'x');
      await owe(DUP, 500);
      const merge = await act({ action: 'merge', keep: KEEP, remove: DUP });
      expect(merge.body.done).toBe(true);
      // The retired lookup rides in the check-in's existing batchGet.
      // Baseline before 003Fixes / 12 (measured on the red run): found 6, not found 3.
      expect(subreq(found)).toBeLessThanOrEqual(6);
      expect(subreq(missing)).toBeLessThanOrEqual(3);
      expect(subreq(merge)).toBeLessThanOrEqual(25);
      console.log(`[p12] subrequests: check-in found ${subreq(found)}, missing ${subreq(missing)}, merge with money ${subreq(merge)}`);
    } finally {
      delete process.env.PERF_TIMING;
    }
  });
});
