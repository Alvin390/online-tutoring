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

/**
 * 013Fixes / 22 — the superadmin's private notes on the school (contact,
 * agreed price, promises) and their history: never sent to a browser, the
 * superadmin's included (it reads them through /api/admin/billing).
 */
describe('config/accountNotes and its history are closed to every client', () => {
  beforeEach(async () => {
    await seed(env, 'config/accountNotes', { contact: 'x', agreedPrice: 'y', promises: 'z' });
    await seed(env, 'config/accountNotes/history/h1', { before: {}, after: { contact: 'x' } });
  });

  it('nobody reads them', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(getDoc(doc(db, 'config/accountNotes')));
      // eslint-disable-next-line no-await-in-loop
      await assertFails(getDoc(doc(db, 'config/accountNotes/history/h1')));
    }
  });

  it('nobody writes them', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(setDoc(doc(db, 'config/accountNotes'), { contact: 'changed' }));
      // eslint-disable-next-line no-await-in-loop
      await assertFails(setDoc(doc(db, 'config/accountNotes/history/h2'), { after: {} }));
    }
  });
});

/** 013Fixes / 25 — the stored Paystack plan prices are the server's fallback. */
describe('config/planPrices is closed to every client', () => {
  beforeEach(async () => {
    await seed(env, 'config/planPrices', { dev: { prices: { bronze: 4999, silver: 7499, gold: 9999 } } });
  });

  it('nobody reads or writes it', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(getDoc(doc(db, 'config/planPrices')));
      // eslint-disable-next-line no-await-in-loop
      await assertFails(setDoc(doc(db, 'config/planPrices'), { dev: { prices: { gold: 1 } } }));
    }
  });
});

/** 013Fixes / 29-30 — the school's M-Pesa keys and the STK switch are the server's. */
describe('config/darajaCredentials and config/mpesaStatus are closed to every client', () => {
  beforeEach(async () => {
    await seed(env, 'config/darajaCredentials', { live: { consumerKey: 'v1.x.y.z' } });
    await seed(env, 'config/mpesaStatus', { enabled: true, online: true });
  });

  it('nobody reads or writes them', async () => {
    for (const db of [anon(env), teacher(env), superadmin(env)]) {
      for (const path of ['config/darajaCredentials', 'config/mpesaStatus']) {
        // eslint-disable-next-line no-await-in-loop
        await assertFails(getDoc(doc(db, path)));
        // eslint-disable-next-line no-await-in-loop
        await assertFails(setDoc(doc(db, path), { online: true }));
      }
    }
  });
});
