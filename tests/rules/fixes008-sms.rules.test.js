import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 008Fixes / 07 — SMS campaigns, credit, usage, pending checks and the setup
 * are the server's. The dashboard reads them through /api/messages/sms and the
 * superadmin endpoint; no browser reads or writes them directly.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'sms/campaigns/items/c1', { status: 'sent' });
  await seed(env, 'sms/campaigns/items/c1/recipients/evening__254711000001', { status: 'sent' });
  for (const d of ['smsBalance', 'smsUsage', 'smsPending', 'smsSetup']) await seed(env, `config/${d}`, { x: 1 });
});

describe('closed to every browser', () => {
  const paths = [
    'sms/campaigns/items/c1', 'sms/campaigns/items/c1/recipients/evening__254711000001',
    'config/smsBalance', 'config/smsUsage', 'config/smsPending', 'config/smsSetup',
  ];
  it('no reads', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      for (const p of paths) await assertFails(getDoc(doc(db, p))); // eslint-disable-line no-await-in-loop
    }
  });
  it('no writes', async () => {
    for (const db of [teacher(env), superadmin(env)]) {
      for (const p of paths) await assertFails(setDoc(doc(db, p), { x: 2 })); // eslint-disable-line no-await-in-loop
    }
  });
});
