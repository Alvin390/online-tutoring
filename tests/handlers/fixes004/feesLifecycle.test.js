import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 004Fixes / 07 — the student lifecycle on the per-session fee account. One
 * number registered in morning AND evening, each owing 2,750 and blocked.
 * Deleting, re-registering, changing the number of, or merging ONE session's
 * record never touches the other session's money (before 004Fixes the account
 * was per number: deleting morning wrote off the evening debt, and changing
 * morning's number moved the evening history with it).
 */

const P = '+254711007007';
const Q = '+254711007008';
const KEEP = '+254711007009';
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx004-life-teacher', teacherClaims.gold, { email: 'life.teacher@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${session}`, parentPhone: phone, class: 'Grade 7', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'QX12345678 Confirmed. Ksh2,750.00 sent', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const blockFees = async (session, phone = P, amount = 2750) => {
  const res = await call('/api/students/bulk', { token: teacher, body: { action: 'block', kind: 'fees', amount, items: [{ session, phone }] } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) {
    await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Grade 7', 'Grade 8'] });
    await seed(s, P);
    await blockFees(s);
  }
});

const student = async (s, phone = P) => {
  const snap = await db.doc(`sessions/${s}/students/${phone}`).get();
  return snap.exists ? snap.data() : null;
};
const account = async (s, phone = P) => (await db.doc(`fees/accounts/items/${s}__${phone}`).get()).data() ?? null;
const ledgerSize = async (s, phone = P) => (await db.collection(`fees/accounts/items/${s}__${phone}/ledger`).get()).size;
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;

describe('delete', () => {
  it('deleting the morning record closes the morning account only; evening still owes 2,750 and stays blocked', async () => {
    expect(await outstanding()).toBe(5500);
    const res = await call('/api/student/remove', { token: teacher, body: { session: 'morning', phone: P } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await student('morning')).toBeNull();
    expect(await account('morning')).toMatchObject({ balance: 0, status: 'closed' });
    expect((await account('morning')).studentDeletedAt).toBeTruthy();
    expect(await account('evening')).toMatchObject({ balance: 2750 });
    expect((await account('evening')).studentDeletedAt).toBeUndefined();
    expect(await student('evening')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect(await outstanding()).toBe(2750);
  });

  it('re-registering the morning number after a delete reopens morning only, at 0', async () => {
    await call('/api/student/remove', { token: teacher, body: { session: 'morning', phone: P } });
    const res = await call('/api/student/register', {
      body: { session: 'morning', phone: P, studentName: 'Brian Otieno', class: 'Grade 8', subjects: ['English', 'Kiswahili', 'Mathematics'], receiptMessage: 'AB12345678 Confirmed. paid' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const morning = await account('morning');
    expect(morning.balance).toBe(0);
    expect(morning.studentDeletedAt).toBeUndefined();
    expect(morning.status).toBeUndefined();
    expect(await account('evening')).toMatchObject({ balance: 2750 });
    expect(await student('evening')).toMatchObject({ blocked: true, feeBalance: 2750 });
  });

  it('the sweep\'s self-heal closes a deleted session\'s old balance, not the live session\'s', async () => {
    // A morning account deleted before balances were closed on deletion (the
    // pre-Phase-13 shape), while the same number is live in evening.
    const past = new Date(Date.now() - 3 * 86_400_000);
    await db.doc(`sessions/morning/students/${P}`).delete();
    await db.doc(`fees/accounts/items/morning__${P}`).set({ studentDeletedAt: past, nextDueDate: past }, { merge: true });
    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deletedClosed).toBe(1);
    expect(await account('morning')).toMatchObject({ balance: 0 });
    expect(await account('evening')).toMatchObject({ balance: 2750 });
    expect((await student('evening')).blocked).toBe(true);
  });
});

describe('change number', () => {
  it('changing the morning number moves the morning account and ledger only; evening stays on the old number', async () => {
    const eveningEntries = await ledgerSize('evening');
    const morningEntries = await ledgerSize('morning');
    const res = await call('/api/student/update', { token: teacher, body: { session: 'morning', phone: P, newPhone: Q, changes: {} } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.moved.ledgerEntries).toBe(morningEntries);
    expect(await account('morning', Q)).toMatchObject({ key: `morning__${Q}`, phone: Q, balance: 2750, phoneChangedFrom: P });
    expect(await ledgerSize('morning', Q)).toBe(morningEntries);
    expect(await account('morning')).toMatchObject({ phoneChanged: Q });
    expect(await ledgerSize('morning')).toBe(0);
    // The evening registration of the old number is untouched.
    expect(await account('evening')).toMatchObject({ balance: 2750 });
    expect(await ledgerSize('evening')).toBe(eveningEntries);
    expect(await account('evening', Q)).toBeNull();
    expect(await student('evening')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect(await student('morning', Q)).toMatchObject({ blocked: true, feeBalance: 2750 });
  });

  it('the old number\'s forwarding marker is a per-session account the sweep recognises (not counted as legacy)', async () => {
    await call('/api/student/update', { token: teacher, body: { session: 'morning', phone: P, newPhone: Q, changes: {} } });
    expect(await account('morning')).toMatchObject({ key: `morning__${P}`, phone: P, session: 'morning', phoneChanged: Q });
    const sweep = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(sweep.status).toBe(200);
    // Phases 10–11 read legacySkipped as "per-phone accounts still to migrate".
    expect(sweep.body.legacySkipped).toBe(0);
  });
});

describe('duplicate merge', () => {
  it('a merge inside evening moves only evening money; the same number in morning keeps its debt', async () => {
    await seed('evening', KEEP);
    await db.doc(`sessions/evening/students/${P}`).set({ duplicateHold: true, duplicateOf: KEEP }, { merge: true });
    const res = await call('/api/students/duplicates', { token: teacher, body: { session: 'evening', action: 'merge', keep: KEEP, remove: P } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: true, balanceMoved: 2750 });
    expect(await account('evening', KEEP)).toMatchObject({ balance: 2750 });
    expect(await account('evening')).toMatchObject({ balance: 0 });
    expect(await student('evening')).toBeNull();
    expect(await account('morning')).toMatchObject({ balance: 2750 });
    expect(await student('morning')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect(await outstanding()).toBe(5500);
  });
});
