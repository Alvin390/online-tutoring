import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed, validRegistration, PHONE_A } from './helpers.js';

/**
 * 014Fixes / 00 — a given number is the server's: only POST /api/student/number
 * (assign) and registration set numberGivenAt.
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

describe('numberGivenAt is server-owned', () => {
  it('a teacher cannot set it; ordinary edits still work', async () => {
    const t = teacher(env);
    await assertFails(updateDoc(doc(t, path(PHONE_A)), { numberGivenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(t, path(PHONE_A)), { blocked: true, blockReason: 'Fees', blockedAt: serverTimestamp() }));
  });

  it('a client registration carrying it is refused', async () => {
    const fresh = '+254711000781';
    await assertFails(setDoc(doc(anon(env), path(fresh)), { ...validRegistration(fresh), numberGivenAt: serverTimestamp() }));
  });
});
