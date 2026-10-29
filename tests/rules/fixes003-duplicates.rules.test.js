import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed, validRegistration, PHONE_A, PHONE_B } from './helpers.js';

/**
 * 003Fixes / 11 — the duplicate fields are server-owned: a teacher cannot
 * write them, and a client registration carrying them is refused.
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
    approvalStatus: 'pending', duplicateHold: true, duplicateOf: PHONE_B,
  });
});

describe('duplicateHold / duplicateOf / duplicateKeep', () => {
  it('a teacher cannot set, change or remove them; other edits still work', async () => {
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { duplicateHold: false }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { duplicateOf: '+254700000009' }));
    await assertFails(updateDoc(doc(teacher(env), path(PHONE_A)), { duplicateKeep: [PHONE_B] }));
    await assertSucceeds(updateDoc(doc(teacher(env), path(PHONE_A)), { blocked: true, blockReason: 'x' }));
  });

  it('a client registration carrying any of them is refused; without them it is accepted', async () => {
    for (const extra of [{ duplicateHold: false }, { duplicateOf: PHONE_A }, { duplicateKeep: [PHONE_A] }]) {
      await assertFails(setDoc(doc(anon(env), path(PHONE_B)), { ...validRegistration(PHONE_B), ...extra }));
    }
    await assertSucceeds(setDoc(doc(anon(env), path(PHONE_B)), validRegistration(PHONE_B)));
  });
});
