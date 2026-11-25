import { getDb } from './firebaseAdmin.js';
import { currentMode, fetchPlan, planCodeForTier, FALLBACK_PRICE_KES } from './paystack.js';
import { deferToBackground } from './requestContext.js';

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
export { FALLBACK_PRICE_KES };
const CACHE_MS = 10 * 60 * 1000;
const FALLBACK_CACHE_MS = 60 * 1000;
const DOC = 'config/planPrices';

let cache = null; // { mode, at, ttl, value }
let inflight = null; // one background Paystack read at a time

// 013Fixes / 28: a plan read never holds a request for long (the default
// Paystack timeout is 15 s); past this, Paystack counts as not answering.
const PLAN_READ_TIMEOUT_MS = 2500;

/** Forget the cached prices (after a price change, and in tests). */
export function invalidatePlanPrices() { cache = null; }
export const __resetPlanPrices = invalidatePlanPrices;

/** The amount on a package's Paystack plan, in whole shillings (or throws). */
async function paystackPlanKes(tier) {
  const plan = await fetchPlan(planCodeForTier(tier), { timeoutMs: PLAN_READ_TIMEOUT_MS });
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

const storedValue = (stored, mode) => ({
  prices: { ...stored.prices }, previous: stored.previous ?? null, source: 'stored', mode,
  fetchedAt: toMs(stored.fetchedAt), changedAt: toMs(stored.changedAt),
});

/**
 * @param {object} [opts]
 * @param {boolean} [opts.background] 013Fixes / 28 — for the SCREENS (status,
 *   the Accounts list): with a stored copy, answer with it at once and ask
 *   Paystack behind the request (its answer replaces the cache for the next
 *   call), so a slow Paystack never holds up a dashboard. The money paths
 *   (checkout, the webhook's check) leave it off and read Paystack directly.
 * @returns {Promise<{ prices: Record<string, number>, previous: Record<string, number>|null,
 *   source: 'paystack'|'stored'|'code', mode: string, fetchedAt: number|null, changedAt: number|null }>}
 */
export async function planPrices(db = getDb(), { fetchPlanKes = paystackPlanKes, mode = currentMode(), now = Date.now(), force = false, background = false } = {}) {
  if (!force && cache && cache.mode === mode && now - cache.at < cache.ttl) return cache.value;

  if (background && !force) {
    const stored = await readStored(db, mode);
    if (stored) {
      const value = storedValue(stored, mode);
      cache = { mode, at: now, ttl: FALLBACK_CACHE_MS, value };
      if (!inflight) {
        inflight = readAndRemember(db, { fetchPlanKes, mode, now }).catch(() => null).finally(() => { inflight = null; });
        deferToBackground(inflight);
      }
      return value;
    }
  }
  return readAndRemember(db, { fetchPlanKes, mode, now });
}

/** Paystack now (then the stored copy, then the code prices); cached and stored. */
async function readAndRemember(db, { fetchPlanKes, mode, now }) {
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
    // A change found here (made in another deployment, or in Paystack's own
    // dashboard) is dated now; one made with the price form has its own date.
    const changedAt = changed ? now : toMs(stored?.changedAt);
    if (changed) {
      try {
        await db.doc(DOC).set({ [mode]: { prices: fresh, previous, fetchedAt: new Date(now), changedAt: new Date(now) } }, { merge: true });
      } catch {
        // Not stored this time; the next good read tries again.
      }
    }
    value = { prices: fresh, previous, source: 'paystack', mode, fetchedAt: now, changedAt };
  } else if (stored) {
    value = storedValue(stored, mode);
  } else {
    value = { prices: { ...FALLBACK_PRICE_KES }, previous: null, source: 'code', mode, fetchedAt: null, changedAt: null };
  }
  cache = { mode, at: now, ttl: value.source === 'paystack' ? CACHE_MS : FALLBACK_CACHE_MS, value };
  return value;
}

/**
 * 013Fixes / 26: after the price form changed a plan on Paystack — the stored
 * copy (with what it was, when and by whom) and this isolate's cache, so this
 * deployment shows it at once (other deployments within CACHE_MS).
 */
export async function recordPriceChange(db, { mode, prices, previous, actor, now = Date.now() }) {
  await db.doc(DOC).set({
    [mode]: { prices, previous, fetchedAt: new Date(now), changedAt: new Date(now), changedBy: actor },
  }, { merge: true });
  const value = { prices: { ...prices }, previous: { ...previous }, source: 'paystack', mode, fetchedAt: now, changedAt: now };
  cache = { mode, at: now, ttl: CACHE_MS, value };
  return value;
}

/**
 * The school's own package's new price, for its billing page: from its next
 * payment (the end the school's countdown shows), until it pays after the
 * change. None for a gifted school, when its package's price didn't change,
 * or when its period or trial began after the change.
 */
export function priceChangeFor(sub, priceInfo, endsAt) {
  const tier = sub?.tier;
  if (!tier || sub.grantedBySuperadmin === true) return null;
  const from = priceInfo?.previous?.[tier];
  const to = priceInfo?.prices?.[tier];
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
  const changedAt = priceInfo.changedAt ?? null;
  const paidAt = toMs(sub.lastPaymentAt);
  if (changedAt != null && paidAt != null && paidAt > changedAt) return null;
  // 013Fixes / 28: a period or trial that began after the change never had
  // the old price, so there is nothing to tell (and nothing to hide later).
  const startedAt = toMs(sub.currentPeriodStart);
  if (changedAt != null && startedAt != null && startedAt > changedAt) return null;
  return { tier, from, to, changedAt, fromDate: endsAt ?? toMs(sub.currentPeriodEnd) };
}

/**
 * The amounts a charge for `tier` may carry and still be "the plan's price":
 * the newest price, the one before the last change (a charge that crosses a
 * change), and the amount the checkout was started with, when known.
 */
export function acceptedPrices(tier, { prices, previous } = {}, checkoutKes = null) {
  return new Set([prices?.[tier], previous?.[tier], checkoutKes].filter((n) => Number.isFinite(n)));
}
