import { describe, it, expect, beforeEach, vi } from 'vitest';
import { planPrices, __resetPlanPrices, FALLBACK_PRICE_KES, acceptedPrices } from '../../../api/_lib/planPrices.js';

/**
 * 013Fixes / 25 — prices come from the shared Paystack plans (owner, round
 * 3). Read for the current mode, cached 10 minutes per isolate; each good
 * read stored in config/planPrices (only when it changed); Paystack down →
 * the stored copy; no copy → the code prices, the last fallback.
 */

function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    docs,
    doc: (path) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: async (value, opts) => {
        writes.push({ path, value, opts });
        docs.set(path, opts?.merge ? deepMerge(docs.get(path) ?? {}, value) : value);
      },
    }),
  };
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? deepMerge(a[k] ?? {}, v) : v;
  return out;
}

const T0 = Date.parse('2026-11-26T08:00:00Z');
const MIN = 60_000;
let calls;
const paystack = (amounts) => vi.fn(async (tier) => {
  calls += 1;
  if (amounts instanceof Error) throw amounts;
  return amounts[tier];
});

beforeEach(() => { __resetPlanPrices(); calls = 0; });

describe('from Paystack', () => {
  it('the three plans\' amounts, stored once, then cached for 10 minutes', async () => {
    const db = fakeDb();
    const read = paystack({ bronze: 5000, silver: 8000, gold: 12000 });
    const p = await planPrices(db, { fetchPlanKes: read, mode: 'dev', now: T0 });
    expect(p).toMatchObject({ prices: { bronze: 5000, silver: 8000, gold: 12000 }, source: 'paystack', mode: 'dev' });
    expect(db.writes).toHaveLength(1);
    expect(db.docs.get('config/planPrices').dev.prices).toEqual({ bronze: 5000, silver: 8000, gold: 12000 });
    expect(calls).toBe(3);
    await planPrices(db, { fetchPlanKes: read, mode: 'dev', now: T0 + 9 * MIN });
    expect(calls).toBe(3);
    await planPrices(db, { fetchPlanKes: read, mode: 'dev', now: T0 + 11 * MIN });
    expect(calls).toBe(6);
    expect(db.writes).toHaveLength(1); // unchanged prices: no second write
  });

  it('a changed price is stored, with the one before it kept as previous', async () => {
    const db = fakeDb({ 'config/planPrices': { dev: { prices: { bronze: 4999, silver: 7499, gold: 9999 }, fetchedAt: new Date(T0 - MIN) } } });
    await planPrices(db, { fetchPlanKes: paystack({ bronze: 4999, silver: 8000, gold: 9999 }), mode: 'dev', now: T0 });
    const stored = db.docs.get('config/planPrices').dev;
    expect(stored.prices.silver).toBe(8000);
    expect(stored.previous).toEqual({ bronze: 4999, silver: 7499, gold: 9999 });
  });

  it('each mode has its own prices (the test and live plans differ)', async () => {
    const db = fakeDb();
    await planPrices(db, { fetchPlanKes: paystack({ bronze: 1, silver: 2, gold: 3 }), mode: 'dev', now: T0 });
    const live = await planPrices(db, { fetchPlanKes: paystack({ bronze: 4999, silver: 7499, gold: 9999 }), mode: 'live', now: T0 });
    expect(live.prices.gold).toBe(9999);
    expect(db.docs.get('config/planPrices').dev.prices.gold).toBe(3);
  });
});

describe('when Paystack can\'t answer', () => {
  it('the stored copy', async () => {
    const db = fakeDb({ 'config/planPrices': { dev: { prices: { bronze: 5000, silver: 8000, gold: 12000 }, fetchedAt: new Date(T0 - 60 * MIN) } } });
    const p = await planPrices(db, { fetchPlanKes: paystack(new Error('down')), mode: 'dev', now: T0 });
    expect(p).toMatchObject({ prices: { silver: 8000 }, source: 'stored' });
    expect(db.writes).toHaveLength(0);
  });

  it('no stored copy: the code prices, the last fallback; tried again after a minute', async () => {
    const db = fakeDb();
    const p = await planPrices(db, { fetchPlanKes: paystack(new Error('down')), mode: 'dev', now: T0 });
    expect(p).toMatchObject({ prices: FALLBACK_PRICE_KES, source: 'code' });
    expect(calls).toBe(3);
    await planPrices(db, { fetchPlanKes: paystack(new Error('down')), mode: 'dev', now: T0 + 30_000 });
    expect(calls).toBe(3);
    await planPrices(db, { fetchPlanKes: paystack({ bronze: 5000, silver: 8000, gold: 12000 }), mode: 'dev', now: T0 + 61_000 });
    expect(calls).toBe(6);
  });

  it('one plan missing or not a whole number of shillings counts as Paystack not answering', async () => {
    const db = fakeDb();
    const p = await planPrices(db, { fetchPlanKes: paystack({ bronze: 5000, silver: undefined, gold: 12000 }), mode: 'dev', now: T0 });
    expect(p.source).toBe('code');
    __resetPlanPrices();
    const q = await planPrices(db, { fetchPlanKes: paystack({ bronze: 5000, silver: 80.5, gold: 12000 }), mode: 'dev', now: T0 });
    expect(q.source).toBe('code');
  });

  it('the stored copy unreadable as well: still the code prices, never an error', async () => {
    const db = { doc: () => ({ get: async () => { throw new Error('firestore down'); }, set: async () => {} }) };
    const p = await planPrices(db, { fetchPlanKes: paystack(new Error('down')), mode: 'dev', now: T0 });
    expect(p.source).toBe('code');
  });
});

describe('which charged amounts are the plan\'s price', () => {
  it('the newest price, the one before a change, and the amount the checkout was started with', () => {
    const prices = { prices: { silver: 8000 }, previous: { silver: 7499 } };
    expect(acceptedPrices('silver', prices, null)).toEqual(new Set([8000, 7499]));
    expect(acceptedPrices('silver', prices, 7600)).toEqual(new Set([8000, 7499, 7600]));
    expect(acceptedPrices('silver', { prices: { silver: 8000 } }, null)).toEqual(new Set([8000]));
  });
});
