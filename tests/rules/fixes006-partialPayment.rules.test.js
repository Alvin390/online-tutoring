import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, student, seed, validRegistration, PHONE_A, PHONE_B } from './helpers.js';

/**
 * 006Fixes / 04 — `partialPayment` (what a partial approval left owing) is
 * server-owned like feeBalance: no client may write it, teacher included.
 */

let env;
const path = (phone) => `sessions/morning/students/${phone}`;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  await seed(env, path(PHONE_A), {
    studentName: 'Amina', parentPhone: PHONE_A, session: 'morning', class: 'Form 3', blocked: false,
    approvalStatus: 'approved', feeBalance: 1550,
    partialPayment: { paid: 1200, owedBefore: 2750, owedAfter: 1550 },
  });
});

describe('partialPayment', () => {
  it('a teacher cannot set, change or remove it; other edits still work', async () => {
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { partialPayment: { paid: 2750, owedBefore: 2750, owedAfter: 0 } }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { partialPayment: null }));
    await assertSucceeds(updateDoc(doc(teacher(env), path(PHONE_A)), { blocked: true, blockReason: 'x' }));
  });

  it('a client registration carrying it is refused; without it, accepted', async () => {
    await assertFails(setDoc(doc(anon(env), path(PHONE_B)), { ...validRegistration(PHONE_B), partialPayment: { paid: 1 } }));
    await assertSucceeds(setDoc(doc(anon(env), path(PHONE_B)), validRegistration(PHONE_B)));
  });
});

/**
 * The dashboard's own writes to a student (src/services/firebase/firestore.js)
 * are merge writes of named fields, so they never touch partialPayment and
 * keep working on a partial payer once the rules are deployed. Exact payloads.
 */
describe('the dashboard direct writes still work on a partial payer', () => {
  const ref = (db) => doc(db, path(PHONE_A));
  it('row Block, Unblock, Decline and the fees-off Approve (teacher)', async () => {
    await assertSucceeds(setDoc(ref(teacher(env)), { blocked: true, blockReason: '', blockedAt: serverTimestamp(), receiptStatus: 'expired' }, { merge: true }));
    await assertSucceeds(setDoc(ref(teacher(env)), { blocked: false, blockReason: '', blockedAt: null, receiptStatus: 'approved', pendingReceipt: null }, { merge: true }));
    await assertSucceeds(setDoc(ref(teacher(env)), { receiptStatus: 'declined', pendingReceipt: null, receiptDeclinedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(ref(teacher(env)), {
      blocked: false, blockReason: '', receiptMessage: 'x', pendingReceipt: null, receiptStatus: 'approved', receiptApprovedAt: serverTimestamp(),
    }, { merge: true }));
  });

  it('the student sending a new receipt', async () => {
    await assertSucceeds(setDoc(ref(student(env, PHONE_A)), { pendingReceipt: 'QAB1234567 Ksh500', receiptStatus: 'pending', receiptSubmittedAt: serverTimestamp() }, { merge: true }));
  });
});
