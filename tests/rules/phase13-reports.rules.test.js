import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * Phase 13 / 06 — reports, upload records, counters and the notification
 * settings are server-only: no client, not even the superadmin's, reads or
 * writes them directly.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'reports/r1', { type: 'bug', title: 't', submittedBy: { uid: 'teacher-uid' } });
  await seed(env, 'reportUploads/r2', { uid: 'teacher-uid' });
  await seed(env, 'counters/reports', { bug: 1 });
  await seed(env, 'config/notifications', { reportRecipient: 'owner@example.com' });
});

const PATHS = ['reports/r1', 'reportUploads/r2', 'counters/reports', 'config/notifications'];
const ROLES = { anonymous: anon, teacher, superadmin };

describe('server-only report data', () => {
  for (const [role, ctx] of Object.entries(ROLES)) {
    for (const path of PATHS) {
      it(`${role} cannot read or write ${path}`, async () => {
        const db = ctx(env);
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { x: 1 }));
      });
    }
  }

  it('a teacher cannot list the reports collection', async () => {
    await assertFails(getDocs(collection(teacher(env), 'reports')));
  });
});
