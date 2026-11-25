import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 013Fixes / 18 — the billing settings are the server's: no client reads or
 * writes config/billing, not even the superadmin's browser (it goes through
 * /api/admin/billing, which validates and audits).
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'config/billing', { trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6 });
});

describe('config/billing is closed to every client', () => {
  it('nobody reads it', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(getDoc(doc(db, 'config/billing')));
    }
  });

  it('nobody writes it', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(setDoc(doc(db, 'config/billing'), { trialDays: 90 }));
    }
  });
});
