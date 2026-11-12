import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, student, seed, validRegistration, PHONE_A, PHONE_B } from './helpers.js';

/**
 * 007Fixes / 07 — the staff marker (`staff`, `staffAt`, `staffBy`) is
 * server-owned: only POST /api/students/staff sets or clears it. And a staff
 * record cannot be blocked from the browser: the row's Block button writes
 * straight to Firestore, so the rule is the only place to stop it.
 *
 * Ordinary students have NO `staff` field at all, so every rule here must
 * read it with a default — a bare `resource.data.staff` on a missing key
 * would refuse every teacher write on every student.
 */

let env;
const path = (phone) => `sessions/morning/students/${phone}`;
const base = (phone) => ({
  studentName: 'Kilemi', parentPhone: phone, session: 'morning', class: 'Form 3', blocked: false,
  approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
});
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  // PHONE_A is staff; PHONE_B is an ordinary student with no `staff` field.
  await seed(env, path(PHONE_A), { ...base(PHONE_A), staff: true, staffAt: new Date(), staffBy: 'teacher-uid' });
  await seed(env, path(PHONE_B), base(PHONE_B));
});

describe('the marker is server-owned', () => {
  it('a teacher cannot set, change or clear staff, staffAt or staffBy', async () => {
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_B)), { staff: true }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_B)), { staffAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_B)), { staffBy: 'me' }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { staff: false }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { staff: null }));
  });

  it('a client registration carrying it is refused; without it, accepted', async () => {
    const fresh = '+254711000777';
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), staff: true }));
    await assertSucceeds(setDoc(doc(anon(env), path(fresh)), validRegistration(fresh)));
  });
});

describe('a staff record cannot be blocked from the browser', () => {
  const block = { blocked: true, blockReason: '', blockedAt: serverTimestamp(), receiptStatus: 'expired' };
  it('the row Block payload is refused on staff, accepted on an ordinary student (no staff field)', async () => {
    await assertFails(setDoc(doc(teacher(env), path(PHONE_A)), block, { merge: true }));
    await assertSucceeds(setDoc(doc(teacher(env), path(PHONE_B)), block, { merge: true }));
  });
});

/**
 * The dashboard's other direct writes (src/services/firebase/firestore.js)
 * keep working on a staff record, and on an ordinary one. Exact payloads.
 */
describe('the dashboard direct writes still work', () => {
  for (const [who, phone] of [['staff', PHONE_A], ['an ordinary student', PHONE_B]]) {
    it(`edit, Unblock, Decline and the fees-off Approve on ${who} (teacher)`, async () => {
      const ref = doc(teacher(env), path(phone));
      await assertSucceeds(setDoc(ref, { studentName: 'Kilemi M.', class: 'Form 3', subjects: 'English, Mathematics' }, { merge: true }));
      await assertSucceeds(setDoc(ref, { blocked: false, blockReason: '', blockedAt: null, receiptStatus: 'approved', pendingReceipt: null }, { merge: true }));
      await assertSucceeds(setDoc(ref, { receiptStatus: 'declined', pendingReceipt: null, receiptDeclinedAt: serverTimestamp() }, { merge: true }));
      await assertSucceeds(setDoc(ref, {
        blocked: false, blockReason: '', receiptMessage: 'x', pendingReceipt: null, receiptStatus: 'approved', receiptApprovedAt: serverTimestamp(),
      }, { merge: true }));
    });

    it(`${who} sending a new receipt`, async () => {
      await assertSucceeds(setDoc(doc(student(env, phone), path(phone)), {
        pendingReceipt: 'QAB1234567 Ksh500', receiptStatus: 'pending', receiptSubmittedAt: serverTimestamp(),
      }, { merge: true }));
    });
  }
});
