import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 002Fixes / 09 — `notificationMarks` (the pre-class reminder's once-only
 * markers) is server-only. No rule names it: Firestore's default deny covers
 * it, so no rules change or deploy is needed. This proves it stays closed.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'notificationMarks/preclass_evening_2026-10-27_60', { session: 'evening', reminder: '60', createdAt: new Date() });
});

const path = 'notificationMarks/preclass_evening_2026-10-27_60';

describe('notificationMarks', () => {
  it('no client reads it — not a visitor, a teacher or the superadmin', async () => {
    await assertFails(getDoc(doc(anon(env), path)));
    await assertFails(getDoc(doc(teacher(env), path)));
    await assertFails(getDoc(doc(superadmin(env), path)));
  });

  it('no client writes it', async () => {
    await assertFails(setDoc(doc(teacher(env), path), { reminder: 'x' }));
    await assertFails(setDoc(doc(superadmin(env), 'notificationMarks/forged'), { reminder: '60' }));
  });
});
