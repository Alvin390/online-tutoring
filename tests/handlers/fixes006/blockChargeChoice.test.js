import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 006Fixes / 09 — blocking someone who already owes (owner, 4 Nov 2026): the
 * teacher chooses "Block for what they owe" (charge: false — no new invoice)
 * or "Add a new charge of KES X" (charge: true, today's behaviour). Bulk and
 * scheduled blocks; a student owing nothing is skipped when nothing is charged.
 */

const phoneN = (n) => `+2547110${String(80000 + n).padStart(5, '0')}`;
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx006-charge-teacher', teacherClaims.gold, { email: 'charge.teacher@school.example' });
});

const seed = (session, phone, extra = {}) => db.doc(`sessions/${session}/students/${phone}`).set({
  studentName: `Kid ${phone.slice(-3)}`, parentPhone: phone, class: 'Form 3', subjects: 'English, Kiswahili, Mathematics',
  receiptMessage: 'QX12345678 Confirmed.', registeredAt: new Date('2026-10-01T06:00:00Z'), session,
  blocked: false, blockReason: '', approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0, ...extra,
});
const bulk = (body) => call('/api/students/bulk', { token: teacher, body });
const student = async (s, p) => (await db.doc(`sessions/${s}/students/${p}`).get()).data() ?? null;
const entries = async (s, p) => (await db.collection(`fees/accounts/items/${s}__${p}/ledger`).get()).docs.map((d) => d.data());
const outstanding = async () => (await db.doc('aggregates/dashboard').get()).data()?.totalOutstanding ?? 0;

/** Owes `amount` and is NOT blocked — a partial payer let in on approval. */
async function owing(session, phone, amount) {
  await seed(session, phone);
  const res = await call('/api/fees/post', { token: teacher, body: { session, phone, type: 'invoice', amount } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true, 'registration.requireApproval': true });
  await db.doc('subscription/current').set({ tier: 'gold', status: 'active' });
  for (const s of ['morning', 'evening']) await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true, classes: ['Form 3'] });
});

describe('bulk block for what they owe (charge: false)', () => {
  it('blocks 3 owing students with no new invoice; balances unchanged; the block message reads the balance', async () => {
    const ps = [phoneN(1), phoneN(2), phoneN(3)];
    for (const [i, p] of ps.entries()) await owing('evening', p, 1000 + i * 250);
    const before = await outstanding();
    const res = await bulk({ action: 'block', kind: 'fees', charge: false, items: ps.map((phone) => ({ session: 'evening', phone })) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ done: 3, skipped: {} });
    for (const [i, p] of ps.entries()) {
      expect(await student('evening', p)).toMatchObject({ blocked: true, receiptStatus: 'expired', blockReason: '', feeBalance: 1000 + i * 250 });
      expect((await entries('evening', p)).filter((e) => e.type === 'invoice')).toHaveLength(1); // only the original
    }
    expect(await outstanding()).toBe(before);
    const list = await bulk({ action: 'list' });
    expect(list.body.actions[0]).toMatchObject({ action: 'block', kind: 'fees', charge: false, amount: null });
  });

  it('a student owing nothing is skipped as nothingOwed', async () => {
    const [a, b] = [phoneN(11), phoneN(12)];
    await owing('evening', a, 1550);
    await seed('evening', b);
    const res = await bulk({ action: 'block', kind: 'fees', charge: false, items: [{ session: 'evening', phone: a }, { session: 'evening', phone: b }] });
    expect(res.body).toMatchObject({ done: 1, skipped: { nothingOwed: 1 } });
    expect(await student('evening', b)).toMatchObject({ blocked: false });
  });

  it('charge: true (and no charge field) still invoices, exactly as before', async () => {
    const [a, b] = [phoneN(21), phoneN(22)];
    await owing('evening', a, 1550);
    await owing('evening', b, 1550);
    expect((await bulk({ action: 'block', kind: 'fees', charge: true, amount: 2750, items: [{ session: 'evening', phone: a }] })).status).toBe(200);
    expect((await bulk({ action: 'block', kind: 'fees', amount: 2750, items: [{ session: 'evening', phone: b }] })).status).toBe(200);
    for (const p of [a, b]) {
      expect((await entries('evening', p)).filter((e) => e.type === 'invoice')).toHaveLength(2);
      expect(await student('evening', p)).toMatchObject({ feeBalance: 4300, blocked: true });
    }
    // A charge still needs an amount.
    expect((await bulk({ action: 'block', kind: 'fees', charge: true, items: [{ session: 'evening', phone: a }] })).status).toBe(400);
  });

  it('Undo of a no-charge block restores the fields and posts no reversal', async () => {
    const p = phoneN(31);
    await owing('evening', p, 1550);
    const res = await bulk({ action: 'block', kind: 'fees', charge: false, items: [{ session: 'evening', phone: p }] });
    const undo = await bulk({ action: 'undo', batchId: res.body.batchId });
    expect(undo.body.undone).toBe(1);
    expect(await student('evening', p)).toMatchObject({ blocked: false, feeBalance: 1550 });
    expect((await entries('evening', p)).filter((e) => e.type === 'reversal')).toHaveLength(0);
  });
});

describe('scheduled', () => {
  async function due(id) {
    await db.doc(`scheduledBlocks/${id}`).set({ dueAtMs: Date.now() - 1000, atMs: Date.now() - 1000 }, { merge: true });
    const run = await call('/api/cron/scheduledBlocksSweep', { headers: CRON(), body: {} });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
  }

  it('a schedule "for what they owe" runs at its time with no invoice', async () => {
    const p = phoneN(41);
    await owing('evening', p, 1550);
    const res = await call('/api/students/scheduled', { token: teacher, body: { action: 'create', atMs: Date.now() + 10 * 60_000, kind: 'fees', charge: false, items: [{ session: 'evening', phone: p }] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const listed = await call('/api/students/scheduled', { token: teacher, body: { action: 'list' } });
    expect(listed.body.schedules[0]).toMatchObject({ kind: 'fees', charge: false, amount: null });
    await due(res.body.batchId);
    expect(await student('evening', p)).toMatchObject({ blocked: true, feeBalance: 1550 });
    expect((await entries('evening', p)).filter((e) => e.type === 'invoice')).toHaveLength(1);
  });

  it('a schedule from before this change (no charge field) still charges', async () => {
    const p = phoneN(42);
    await owing('evening', p, 1550);
    const res = await call('/api/students/scheduled', { token: teacher, body: { action: 'create', atMs: Date.now() + 10 * 60_000, kind: 'fees', amount: 500, items: [{ session: 'evening', phone: p }] } });
    await db.doc(`scheduledBlocks/${res.body.batchId}`).update({ charge: null });
    await due(res.body.batchId);
    expect(await student('evening', p)).toMatchObject({ blocked: true, feeBalance: 2050 });
  });
});
