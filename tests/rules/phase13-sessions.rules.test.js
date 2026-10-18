import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, seed } from './helpers.js';

/**
 * Phase 13 / 02 D6 + D8 — the rules side of teacher-defined sessions.
 *
 * Registration used to require `session == 'morning' || session == 'evening'`,
 * so a student could never register into a session the teacher created
 * (validated: denied). Now it requires the session DOCUMENT to exist and be
 * active, with a transitional clause for morning/evening before bootstrap.
 */

let env;

beforeAll(async () => {
  env = await makeTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const registration = (phone, session) => ({
  studentName: 'Amina Wanjiru',
  parentPhone: phone,
  class: 'Grade 8',
  subjects: 'Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed',
  registeredAt: serverTimestamp(),
  session,
  blocked: false,
  approvalStatus: 'pending',
  receiptStatus: 'pending',
  feeBalance: 0,
});

const sessionDoc = (slug, extra = {}) => ({
  name: 'Weekend Class', slug, active: true, order: 2, icon: 'bi-book-fill',
  gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', schedule: null,
  ...extra,
});

describe('registration into teacher-defined sessions', () => {
  it('is allowed into an existing active custom session', async () => {
    await seed(env, 'sessions/weekend', sessionDoc('weekend'));
    await assertSucceeds(
      setDoc(doc(anon(env), 'sessions/weekend/students/+254711000020'), registration('+254711000020', 'weekend'))
    );
  });

  it('is denied into a session that does not exist', async () => {
    await assertFails(
      setDoc(doc(anon(env), 'sessions/ghost/students/+254711000021'), registration('+254711000021', 'ghost'))
    );
  });

  it('is denied into an inactive (hidden) session', async () => {
    await seed(env, 'sessions/paused', sessionDoc('paused', { active: false }));
    await assertFails(
      setDoc(doc(anon(env), 'sessions/paused/students/+254711000022'), registration('+254711000022', 'paused'))
    );
  });

  it('transitional: morning and evening are allowed before their documents exist', async () => {
    await assertSucceeds(
      setDoc(doc(anon(env), 'sessions/morning/students/+254711000023'), registration('+254711000023', 'morning'))
    );
    await assertSucceeds(
      setDoc(doc(anon(env), 'sessions/evening/students/+254711000024'), registration('+254711000024', 'evening'))
    );
  });

  it('still requires the body session to match the path', async () => {
    await seed(env, 'sessions/weekend', sessionDoc('weekend'));
    await assertFails(
      setDoc(doc(anon(env), 'sessions/weekend/students/+254711000025'), registration('+254711000025', 'morning'))
    );
  });
});

describe('session document shape (D8)', () => {
  it('accepts description and a schedule', async () => {
    await assertSucceeds(
      setDoc(doc(teacher(env), 'sessions/saturday'), sessionDoc('saturday', {
        description: 'Exam prep.',
        schedule: { days: [6], startTime: '09:00', endTime: '12:00', tz: 'Africa/Nairobi' },
      }))
    );
  });

  it('rejects a description over 160 characters', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/saturday'), sessionDoc('saturday', { description: 'x'.repeat(161) }))
    );
  });

  it('rejects an unknown key', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/saturday'), sessionDoc('saturday', { colour: 'red' }))
    );
  });

  it('rejects the new reserved slugs', async () => {
    for (const slug of ['reports', 'support']) {
      await assertFails(setDoc(doc(teacher(env), `sessions/${slug}`), sessionDoc(slug)));
    }
  });
});
