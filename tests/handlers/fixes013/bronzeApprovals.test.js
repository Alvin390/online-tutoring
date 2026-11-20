import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, phoneN, userWithClaims, teacherClaims, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 04 — owner: "Let them keep the approvals, just the approvals on
 * being blocked." Every plan approves a blocked student back in. Recording
 * money with it is the plan's fee payments (Silver and up): on Bronze any
 * payment detail is refused, nothing touches the ledger, and the student is
 * let back in whatever they owe — single and bulk alike.
 */

let db;
let goldClaim;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  goldClaim = await userWithClaims('fx013b-gold-claim', teacherClaims.gold); // the claim never decides
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
});

const RECEIPT = 'UK2PK0FF1R Confirmed. Ksh1,000.00 paid to SCHOOL';
/** Fee-blocked, owing 1,000, with a receipt waiting (as a Silver school left it). */
async function blockedOwing(phone, owed = 1000) {
  await db.doc(`sessions/morning/students/${phone}`).set({
    studentName: 'Kid', parentPhone: phone, class: 'Form 3', subjects: 'English', session: 'morning',
    receiptMessage: 'OLD1234567 Confirmed', pendingReceipt: RECEIPT, registeredAt: new Date('2026-10-01T06:00:00Z'),
    blocked: true, blockReason: '', approvalStatus: 'approved', receiptStatus: 'pending', feeBalance: owed,
  });
  await db.doc(`fees/accounts/items/morning__${phone}`).set({ phone, session: 'morning', balance: owed });
}
const student = async (p) => (await db.doc(`sessions/morning/students/${p}`).get()).data();
const ledger = async (p) => (await db.collection(`fees/accounts/items/morning__${p}/ledger`).get()).size;
const account = async (p) => (await db.doc(`fees/accounts/items/morning__${p}`).get()).data().balance;
const approve = (body) => call('/api/fees/approveReceipt', { token: goldClaim, body });
const bulk = (body) => call('/api/students/bulk', { token: goldClaim, body });

describe('Bronze: approve back in, no money', () => {
  beforeEach(() => seedPlan(db, 'bronze'));

  it('single: unblocked although they still owe; no ledger entry; no money in the reply; audited', async () => {
    await blockedOwing(phoneN(1));
    const res = await approve({ session: 'morning', phone: phoneN(1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true, posted: false, entryId: null, paid: 0, partial: false, balance: null, stillBlocked: false, stillOwes: null });

    const s = await student(phoneN(1));
    expect(s).toMatchObject({ blocked: false, receiptStatus: 'approved', receiptMessage: RECEIPT, pendingReceipt: null, feeBalance: 1000 });
    expect(await ledger(phoneN(1))).toBe(0);
    expect(await account(phoneN(1))).toBe(1000);

    const audit = (await db.collection('audit').where('action', '==', 'receipt.approved').get()).docs[0].data();
    expect(audit.after).toMatchObject({ blocked: false, balance: null, entryId: null });
  });

  it('single: any payment detail is refused, even crafted, and nothing changes', async () => {
    await blockedOwing(phoneN(2));
    for (const extra of [{ payment: 'full' }, { payment: 'partial', amount: 500 }, { amount: 1000 }, { method: 'cash' }, { reference: 'UK2PK0FF1R' }]) {
      const res = await approve({ session: 'morning', phone: phoneN(2), ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(403);
      expect(res.body.error.code).toBe('tier_required');
    }
    expect((await student(phoneN(2))).blocked).toBe(true);
    expect(await ledger(phoneN(2))).toBe(0);
  });

  it('bulk: everyone let back in, no posting, even with fees on', async () => {
    await blockedOwing(phoneN(3));
    await blockedOwing(phoneN(4), 0);
    const res = await bulk({ action: 'approveReceipts', items: [{ session: 'morning', phone: phoneN(3) }, { session: 'morning', phone: phoneN(4) }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.done).toBe(2);
    expect((await student(phoneN(3))).blocked).toBe(false);
    expect((await student(phoneN(4))).blocked).toBe(false);
    expect(await ledger(phoneN(3))).toBe(0);
    expect(await account(phoneN(3))).toBe(1000);
  });

  it('bulk: a payment or a per-student amount is refused', async () => {
    await blockedOwing(phoneN(5));
    for (const body of [
      { action: 'approveReceipts', payment: 'full', items: [{ session: 'morning', phone: phoneN(5) }] },
      { action: 'approveReceipts', payment: 'partial', items: [{ session: 'morning', phone: phoneN(5), amount: 400 }] },
      { action: 'approveReceipts', items: [{ session: 'morning', phone: phoneN(5), amount: 400 }] },
    ]) {
      const res = await bulk(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe('tier_required');
    }
    expect((await student(phoneN(5))).blocked).toBe(true);
    expect(await ledger(phoneN(5))).toBe(0);
  });
});

describe('Silver: the full approval, as before', () => {
  beforeEach(() => seedPlan(db, 'silver'));

  it('single Complete records what is owed', async () => {
    await blockedOwing(phoneN(6));
    const res = await approve({ session: 'morning', phone: phoneN(6), payment: 'full' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ posted: true, paid: 1000, balance: 0, stillOwes: false });
    expect(await ledger(phoneN(6))).toBe(1);
  });

  it('single Partial records the amount and keeps the rest owing', async () => {
    await blockedOwing(phoneN(7));
    const res = await approve({ session: 'morning', phone: phoneN(7), payment: 'partial', amount: 400 });
    expect(res.body).toMatchObject({ posted: true, paid: 400, balance: 600, partial: true });
  });

  it('bulk Complete records each balance', async () => {
    await blockedOwing(phoneN(8));
    const res = await bulk({ action: 'approveReceipts', payment: 'full', items: [{ session: 'morning', phone: phoneN(8) }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await ledger(phoneN(8))).toBe(1);
    expect(await account(phoneN(8))).toBe(0);
  });
});
