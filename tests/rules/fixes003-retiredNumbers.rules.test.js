import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, student, seed, PHONE_A } from './helpers.js';

/** 003Fixes / 12 — retired numbers are server-only: no client reads or writes them. */

let env;
const path = `sessions/morning/retiredNumbers/${PHONE_A}`;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  await seed(env, path, { reason: 'merged', keptSuffix: '678', at: new Date(), by: 'teacher-1' });
});

describe('retiredNumbers', () => {
  it('denied to every client role, read and write', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env), student(env, PHONE_A)]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { reason: 'duplicate' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
});
