import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed, validRegistration, PHONE_A, PHONE_B } from './helpers.js';

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
