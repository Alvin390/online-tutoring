import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, student, seed, PHONE_A } from './helpers.js';

/**
 * Phase 13 / 08 B3 — the check-in heartbeat lives at
 * sessions/{s}/students/{p}/meta/activity. Teachers may read it; only the
 * server writes it.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, `sessions/morning/students/${PHONE_A}/meta/activity`, { lastAccessed: new Date() });
});

const path = `sessions/morning/students/${PHONE_A}/meta/activity`;

describe('meta/activity', () => {
  it('a teacher can read it', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), path)));
  });

  it('nobody writes it from a client — not even a teacher', async () => {
    await assertFails(setDoc(doc(teacher(env), path), { lastAccessed: new Date() }));
    await assertFails(setDoc(doc(anon(env), path), { lastAccessed: new Date() }));
  });

  it('anonymous visitors and the student cannot read it', async () => {
    await assertFails(getDoc(doc(anon(env), path)));
    await assertFails(getDoc(doc(student(env, PHONE_A), path)));
  });
});
