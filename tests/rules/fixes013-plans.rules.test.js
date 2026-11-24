import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeTestEnv, anon, teacher, superadmin, seed } from './helpers.js';

/**
 * 013Fixes / 00 — the superadmin's plan settings (`config/plans`) are the
 * server's. Screens get the effective plan through /api/billing/status and the
 * superadmin edits it through an endpoint (013Fixes / 07); no browser reads or
 * writes the document directly. No rule was added: the default deny covers it.
 */

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seed(env, 'config/plans', { bronze: { features: { calendar: true } } });
});

describe('config/plans is closed to every browser', () => {
  it('no reads', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      await assertFails(getDoc(doc(db, 'config/plans'))); // eslint-disable-line no-await-in-loop
    }
  });

  it('no writes', async () => {
    for (const db of [teacher(env), superadmin(env)]) {
      await assertFails(setDoc(doc(db, 'config/plans'), { bronze: { features: { fees: true } } })); // eslint-disable-line no-await-in-loop
    }
  });
});

describe('no rule decides by plan', () => {
  it('firestore.rules never reads a plan claim', () => {
    const rules = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'firestore.rules'), 'utf8');
    expect(rules).not.toMatch(/\.tier\b|tierRank|subActive/);
  });
});

// 013Fixes / 09: seats are counted from users/{uid}.disabled, so no browser
// may write it — not even to its own document (only the server does).
describe('users documents (login seats) are written by the server only', () => {
  it('a teacher can read their own, write none', async () => {
    await seed(env, 'users/teacher-uid', { role: 'teacher', disabled: false });
    await assertSucceeds(getDoc(doc(teacher(env), 'users/teacher-uid')));
    await assertFails(setDoc(doc(teacher(env), 'users/teacher-uid'), { role: 'teacher', disabled: false, x: 1 }));
    await assertFails(setDoc(doc(teacher(env), 'users/someone-else'), { role: 'teacher', disabled: true }));
    await assertFails(getDoc(doc(teacher(env), 'users/someone-else')));
  });
});

// 013Fixes / 14: the SMS units (sms/credits and its ledger) are the server's,
// under the existing sms/** rule: no browser may read or change a balance.
describe('SMS units are closed to every browser', () => {
  it('no reads, no writes', async () => {
    await seed(env, 'sms/credits', { granted: 1000, includedUsed: 0, topup: 0 });
    await seed(env, 'sms/credits/ledger/grant:w', { type: 'grant', units: 1000 });
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      await assertFails(getDoc(doc(db, 'sms/credits'))); // eslint-disable-line no-await-in-loop
      await assertFails(getDoc(doc(db, 'sms/credits/ledger/grant:w'))); // eslint-disable-line no-await-in-loop
    }
    await assertFails(setDoc(doc(teacher(env), 'sms/credits'), { topup: 99999 }));
    await assertFails(setDoc(doc(superadmin(env), 'sms/credits/ledger/x'), { type: 'topup_added', units: 5 }));
  });
});

