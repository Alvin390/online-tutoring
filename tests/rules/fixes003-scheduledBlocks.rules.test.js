import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 003Fixes / 07 — only the server schedules a block: `scheduledBlock` on a
 * student is server-owned, and `scheduledBlocks` (with its members) is closed
 * to every client by Firestore's default deny.
 */

let env;
const student = 'sessions/morning/students/+254700000001';
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sessions/morning', { slug: 'morning', name: 'Morning', active: true });
  await seed(env, student, { studentName: 'Amina', parentPhone: '+254700000001', session: 'morning', class: 'Form 3', blocked: false });
  await seed(env, 'scheduledBlocks/s1', { uid: 'teacher-1', status: 'scheduled', atMs: 1, dueAtMs: 1 });
  await seed(env, 'scheduledBlocks/s1/members/morning__254700000001', { session: 'morning', phone: '+254700000001', status: 'scheduled' });
});

describe('scheduledBlock on a student', () => {
  it('a teacher cannot set, change or remove it; their other edits still work', async () => {
    await assertFails(updateDoc(doc(teacher(env), student), { scheduledBlock: { atMs: 1, batchId: 's1' } }));
    await assertSucceeds(updateDoc(doc(teacher(env), student), { blocked: true, blockReason: 'x' }));
  });
});

describe('scheduledBlocks', () => {
  it('no client reads or writes a schedule or its members', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      await assertFails(getDoc(doc(db, 'scheduledBlocks/s1')));
      await assertFails(getDoc(doc(db, 'scheduledBlocks/s1/members/morning__254700000001')));
    }
    await assertFails(setDoc(doc(teacher(env), 'scheduledBlocks/forged'), { uid: 'teacher-1', dueAtMs: 1 }));
    await assertFails(setDoc(doc(superadmin(env), 'scheduledBlocks/s1'), { status: 'cancelled' }, { merge: true }));
  });
});
