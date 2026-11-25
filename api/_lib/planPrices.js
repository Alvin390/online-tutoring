import { getDb } from './firebaseAdmin.js';
import { currentMode, fetchPlan, planCodeForTier, TIER_PRICE_KES } from './paystack.js';

/**
 * Plan prices — 013Fixes / 25 (owner, round 3: keep the Paystack plans,
 * monthly, SHARED across every school deployment). The price of each package
 * is the amount on its Paystack plan for the current mode (test or live):
 *
 *   - read from Paystack at most once per CACHE_MS per isolate (three GETs);
 *   - each good read is stored in config/planPrices[mode] when it changed,
 *     with the prices before it as `previous` (the webhook accepts both
 *     around a change);
 *   - Paystack unreachable (or a plan missing, or not whole shillings): the
 *     stored copy; nothing stored: the code prices (FALLBACK_PRICE_KES), the
 *     last fallback. A fallback is kept only FALLBACK_CACHE_MS, so Paystack
 *     is asked again soon.
 *
 * Never throws: a price is always available.
 */

export const TIERS = ['bronze', 'silver', 'gold'];
export const FALLBACK_PRICE_KES = TIER_PRICE_KES;
const CACHE_MS = 10 * 60 * 1000;
const FALLBACK_CACHE_MS = 60 * 1000;
const DOC = 'config/planPrices';

let cache = null; // { mode, at, ttl, value }

/** Forget the cached prices (after a price change, and in tests). */
export function invalidatePlanPrices() { cache = null; }
export const __resetPlanPrices = invalidatePlanPrices;

/** The amount on a package's Paystack plan, in whole shillings (or throws). */
async function paystackPlanKes(tier) {
  const plan = await fetchPlan(planCodeForTier(tier));
  return typeof plan?.amount === 'number' ? plan.amount / 100 : null;
}

const wholeKes = (n) => Number.isInteger(n) && n >= 1;
const same = (a, b) => Boolean(a && b) && TIERS.every((t) => a[t] === b[t]);
const toMs = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : null);

async function readStored(db, mode) {
  try {
    const snap = await db.doc(DOC).get();
    const entry = snap.exists ? snap.data()?.[mode] : null;
    if (entry?.prices && TIERS.every((t) => wholeKes(entry.prices[t]))) return entry;
  } catch {
    // Unreadable: the code prices will do.
  }
  return null;
}

/**
 * @returns {Promise<{ prices: Record<string, number>, previous: Record<string, number>|null,
 *   source: 'paystack'|'stored'|'code', mode: string, fetchedAt: number|null }>}
 */
export async function planPrices(db = getDb(), { fetchPlanKes = paystackPlanKes, mode = currentMode(), now = Date.now(), force = false } = {}) {
  if (!force && cache && cache.mode === mode && now - cache.at < cache.ttl) return cache.value;

  let fresh = null;
  try {
    const amounts = await Promise.all(TIERS.map((t) => fetchPlanKes(t)));
    if (amounts.every(wholeKes)) fresh = Object.fromEntries(TIERS.map((t, i) => [t, amounts[i]]));
  } catch {
    fresh = null;
  }

  const stored = await readStored(db, mode);
  let value;
  if (fresh) {
    const changed = !same(fresh, stored?.prices);
    const previous = changed ? (stored?.prices ?? null) : (stored?.previous ?? null);
    if (changed) {
      try {
        await db.doc(DOC).set({ [mode]: { prices: fresh, previous, fetchedAt: new Date(now) } }, { merge: true });
      } catch {
        // Not stored this time; the next good read tries again.
      }
    }
    value = { prices: fresh, previous, source: 'paystack', mode, fetchedAt: now };
  } else if (stored) {
    value = { prices: { ...stored.prices }, previous: stored.previous ?? null, source: 'stored', mode, fetchedAt: toMs(stored.fetchedAt) };
  } else {
    value = { prices: { ...FALLBACK_PRICE_KES }, previous: null, source: 'code', mode, fetchedAt: null };
  }
  cache = { mode, at: now, ttl: value.source === 'paystack' ? CACHE_MS : FALLBACK_CACHE_MS, value };
  return value;
}

/**
 * The amounts a charge for `tier` may carry and still be "the plan's price":
 * the newest price, the one before the last change (a charge that crosses a
 * change), and the amount the checkout was started with, when known.
 */
export function acceptedPrices(tier, { prices, previous } = {}, checkoutKes = null) {
  return new Set([prices?.[tier], previous?.[tier], checkoutKes].filter((n) => Number.isFinite(n)));
}
