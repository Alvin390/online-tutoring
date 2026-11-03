import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags, userWithClaims, teacherClaims,
} from '../_worker.js';

/**
 * 004Fixes / 06 — fees per session (owner, 31 Oct–1 Nov): each session's
 * registration is its own student for money — its own balance, block,
 * payments and statement — even when the same number is in both sessions.
 * Accounts are keyed `fees/accounts/items/{session}__{phone}`.
 *
 * Moved from plan/repro/sharedPhoneFees.repro.handler.js (which pinned the
 * shared per-phone account: a morning payment cleared the evening debt while
 * the evening child stayed blocked; a second block showed 5,500).
 */

const P = '+254711004004';
const CRON = () => ({ authorization: `Bearer ${process.env.CRON_SECRET}` });
let db; let teacher;
beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  teacher = await userWithClaims('fx004-fees-teacher', teacherClaims.gold, { email: 'fees.teacher@school.example' });
});
beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true, 'fees.enabled': true });
  for (const s of ['morning', 'evening']) {
    await db.doc(`sessions/${s}`).set({ slug: s, name: s, active: true });
    await db.doc(`sessions/${s}/students/${P}`).set({
      studentName: `Kid ${s}`, parentPhone: P, class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed',
      registeredAt: new Date('2026-10-01T06:00:00Z'), session: s, blocked: false, blockReason: '',
      approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
  }
});

const student = async (s) => (await db.doc(`sessions/${s}/students/${P}`).get()).data();
const account = async (s) => (await db.doc(`fees/accounts/items/${s}__${P}`).get()).data();
const ledger = async (s) => (await db.collection(`fees/accounts/items/${s}__${P}/ledger`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const legacyAccount = () => db.doc(`fees/accounts/items/${P}`).get();
const blockFees = (session, amount) => call('/api/students/bulk', { token: teacher, body: { action: 'block', kind: 'fees', amount, items: [{ session, phone: P }] } });
const post = (body) => call('/api/fees/post', { token: teacher, body: { phone: P, ...body } });
const pay = (session, amount) => post({ session, type: 'payment', amount, method: 'cash' });

describe('each session has its own account', () => {
  it('an evening fee block opens the evening account only, keyed session__phone, with key/session/phone on it', async () => {
    expect((await blockFees('evening', 2750)).status).toBe(200);
    expect(await account('evening')).toMatchObject({ key: `evening__${P}`, session: 'evening', phone: P, balance: 2750 });
    expect(await account('morning')).toBeUndefined();
    expect((await legacyAccount()).exists).toBe(false);
    expect(await student('evening')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect((await student('morning')).feeBalance).toBe(0);
  });

  it('a morning payment does not touch the evening debt or block', async () => {
    await blockFees('evening', 2750);
    expect((await pay('morning', 2750)).status).toBe(200);
    expect(await student('evening')).toMatchObject({ blocked: true, feeBalance: 2750 });
    expect((await account('evening')).balance).toBe(2750);
    expect((await account('morning')).balance).toBe(-2750);
  });

  it('fee-blocking both: each record shows its own 2,750, not 5,500', async () => {
    await blockFees('evening', 2750);
    await blockFees('morning', 2750);
    expect((await student('morning')).feeBalance).toBe(2750);
    expect((await student('evening')).feeBalance).toBe(2750);
    expect((await account('morning')).balance).toBe(2750);
  });

  it('paying evening unblocks evening only (auto-unblock per record)', async () => {
    await blockFees('evening', 2750);
    await blockFees('morning', 2750);
    expect((await post({ session: 'evening', type: 'payment', amount: 2750, method: 'cash', autoUnblock: true })).status).toBe(200);
    expect(await student('evening')).toMatchObject({ blocked: false, feeBalance: 0 });
    expect(await student('morning')).toMatchObject({ blocked: true, feeBalance: 2750 });
  });
});

describe('reversal, reference and statement stay inside the session', () => {
  it('reversing an evening entry restores evening only', async () => {
    await blockFees('evening', 2750);
    await blockFees('morning', 2750);
    const entryId = (await ledger('evening')).find((e) => e.type === 'invoice' || e.type === 'adjustment').id;
    const res = await post({ session: 'evening', type: 'reversal', reversesEntryId: entryId, note: 'wrong row' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await account('evening')).balance).toBe(0);
    expect((await account('morning')).balance).toBe(2750);
    expect((await ledger('evening')).find((e) => e.id === entryId).reversedByEntryId).toBeTruthy();
  });

  it('adding a missing reference finds the entry in that session\'s ledger', async () => {
    await pay('evening', 500);
    const entryId = (await ledger('evening'))[0].id;
    const res = await call('/api/fees/annotate', { token: teacher, body: { session: 'evening', phone: P, entryId, reference: 'TJK9XYZ8QP' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await ledger('evening'))[0].reference).toBe('TJK9XYZ8QP');
    const audit = (await db.collection('audit').where('action', '==', 'fees.reference_added').get()).docs[0].data();
    expect(audit.target).toBe(`fees/accounts/items/evening__${P}/ledger/${entryId}`);
  });

  it('the fee summary and statement are that session\'s', async () => {
    await blockFees('evening', 2750);
    await pay('morning', 400);
    const res = await call('/api/fees/summary', { token: teacher, body: { session: 'morning', phone: P } });
    expect(res.status).toBe(200);
    expect(res.body.summary.balance).toBe(-400);
    expect(res.body.entries.map((e) => e.session)).toEqual(['morning']);
  });
});

describe('approving a receipt pays that row\'s session', () => {
  it('approve receipt with an amount on morning pays morning only', async () => {
    await blockFees('evening', 2750);
    await blockFees('morning', 2750);
    await db.doc(`sessions/morning/students/${P}`).set({ pendingReceipt: 'QAB123XYZ9 Confirmed. Ksh2,750.00 sent', receiptStatus: 'pending', receiptSubmittedAt: new Date() }, { merge: true });
    const res = await call('/api/fees/approveReceipt', { token: teacher, body: { session: 'morning', phone: P, amount: 2750, method: 'mpesa', reference: 'QAB123XYZ9' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await account('morning')).balance).toBe(0);
    expect((await account('evening')).balance).toBe(2750);
    expect((await student('evening')).blocked).toBe(true);
  });

  it('bulk approve on evening pays the evening balance only', async () => {
    await blockFees('evening', 2750);
    await blockFees('morning', 1000);
    await db.doc(`sessions/evening/students/${P}`).set({ pendingReceipt: 'QZZ9988776 Confirmed. Ksh2,750.00 sent', receiptStatus: 'expired' }, { merge: true });
    const res = await call('/api/students/bulk', { token: teacher, body: { action: 'approveReceipts', items: [{ session: 'evening', phone: P }] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.done).toBe(1);
    expect((await ledger('evening')).find((e) => e.type === 'payment')).toMatchObject({ magnitude: 2750, reference: 'QZZ9988776' });
    expect((await account('evening')).balance).toBe(0);
    expect((await account('morning')).balance).toBe(1000);
    expect(await student('morning')).toMatchObject({ blocked: true, feeBalance: 1000 });
  });
});

describe('the invoice run and the nightly sweep', () => {
  it('a number in both sessions gets one invoice per session account (neither overwrites the other)', async () => {
    await db.doc('fees/config').set({ defaultFeeByClass: { 'Form 3': 1200 }, billingDayOfMonth: 1, gracePeriodDays: 7, invoicePrefix: 'INV' });
    const res = await call('/api/fees/generateInvoices', { token: teacher, body: { period: '2026-11' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.issued).toHaveLength(2);
    expect((await account('morning')).balance).toBe(1200);
    expect((await account('evening')).balance).toBe(1200);
    const invoices = (await db.collection('fees/invoices/items').get()).docs.map((d) => d.id).sort();
    expect(invoices).toEqual([`2026-11_evening__${P}`, `2026-11_morning__${P}`]);
  });

  it('the sweep marks the right student overdue from the account\'s own fields, and leaves legacy per-phone ids alone', async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    await db.doc(`fees/accounts/items/evening__${P}`).set({ key: `evening__${P}`, phone: P, session: 'evening', balance: 900, nextDueDate: past });
    await db.doc(`fees/accounts/items/${P}`).set({ phone: P, session: 'morning', balance: 5000, nextDueDate: past });
    const res = await call('/api/cron/feesSweep', { headers: CRON(), body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await student('evening')).overdue).toBe(true);
    expect((await student('morning')).overdue).toBeUndefined();
    expect((await db.doc(`sessions/evening/students/evening__${P}`).get()).exists).toBe(false);
    expect((await account('evening')).status).toBe('overdue');
    expect((await legacyAccount()).data().status).toBeUndefined();
  });
});

describe('the key itself', () => {
  it('accountKey refuses a missing or malformed session instead of building a wrong path', async () => {
    const { accountKey } = await import('../../../api/_lib/ledger.js');
    expect(accountKey('evening', P)).toBe(`evening__${P}`);
    expect(() => accountKey(P)).toThrow();
    expect(() => accountKey(undefined, P)).toThrow();
    expect(() => accountKey('eve__ning', P)).toThrow();
    expect(() => accountKey('evening', '0711004004')).toThrow();
  });
});
