import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 003Fixes / 04 — `bulkActions` (a bulk action and what each student looked
 * like before it, for Undo) is server-only. No rule names it: Firestore's
 * default deny covers it. This proves it stays closed.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'bulkActions/b1', { uid: 'teacher-1', action: 'block', status: 'done', createdAtMs: 1 });
  await seed(env, 'bulkActions/b1/items/morning__254700000001', { session: 'morning', phone: '+254700000001', before: { blocked: false } });
});

describe('bulkActions', () => {
  it('no client reads a batch or its items — not a visitor, the teacher who made it, or the superadmin', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      await assertFails(getDoc(doc(db, 'bulkActions/b1')));
      await assertFails(getDoc(doc(db, 'bulkActions/b1/items/morning__254700000001')));
      await assertFails(getDocs(collection(db, 'bulkActions')));
    }
  });

  it('no client writes one (an undo record must not be forgeable)', async () => {
    await assertFails(setDoc(doc(teacher(env), 'bulkActions/forged'), { uid: 'teacher-1', action: 'block' }));
    await assertFails(setDoc(doc(teacher(env), 'bulkActions/b1/items/x'), { before: { blocked: true } }));
    await assertFails(setDoc(doc(superadmin(env), 'bulkActions/b1'), { status: 'undone' }, { merge: true }));
  });
});
