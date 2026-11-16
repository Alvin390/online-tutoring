import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed, validRegistration, PHONE_A } from './helpers.js';

/**
 * 009Fixes / 02 — a student's one-time number fix is the server's: only
 * POST /api/student/fixNumber sets numberFixedAt / numberFixedFrom.
 */

let env;
const path = (phone) => `sessions/morning/students/${phone}`;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  await seed(env, path(PHONE_A), {
    studentName: 'Kilemi', parentPhone: PHONE_A, session: 'morning', class: 'Form 3', blocked: false,
    approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
  });
});

describe('the number-fix fields are server-owned', () => {
  it('a teacher cannot set them; ordinary edits still work', async () => {
    const t = teacher(env);
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { numberFixedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { numberFixedFrom: '+254711000999' }));
    await assertSucceeds(updateDoc(doc(t, path(PHONE_A)), { blocked: true, blockReason: 'Fees', blockedAt: serverTimestamp() }));
  });

  it('a client registration carrying them is refused', async () => {
    const fresh = '+254711000779';
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), numberFixedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), numberFixedFrom: '+254711000999' }));
  });
});
