import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { currentMode, planCodeForTier, updatePlanAmount } from '../_lib/paystack.js';
import { planPrices, recordPriceChange, TIERS } from '../_lib/planPrices.js';

/**
 * The price form — 013Fixes / 26 (owner: "a form for changing prices for each
 * package that will change everywhere even in Paystack and update
 * immediately"; it applies from each school's next payment).
 *
 *   get      each plan's price for the current mode (cached), and its source
 *   refresh  the same, asked of Paystack now ("Refresh prices now": a change
 *            made in another deployment shows here at once)
 *   change   { tier, amountKes, confirmName? } — Paystack FIRST (the plans are
 *            shared by every school; existing card subscriptions take it from
 *            their next billing cycle); only when Paystack has it, the stored
 *            copy, this isolate's cache, and the audit. In live mode the
 *            plan's name must be typed back. Bronze < Silver < Gold is only a
 *            warning.
 */

const NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get') }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
  z.object({
    action: z.literal('change'),
    tier: z.enum(TIERS),
    amountKes: z.number().int().min(1).max(1_000_000),
    confirmName: z.string().trim().max(40).optional(),
  }).strict(),
]);

const view = (p) => ({ mode: p.mode, prices: p.prices, previous: p.previous, source: p.source, fetchedAt: p.fetchedAt, changedAt: p.changedAt });

/** "Silver now costs more than Gold." when the plans are out of order. */
export function orderWarning(prices) {
  for (const [lower, higher] of [['bronze', 'silver'], ['silver', 'gold']]) {
    if (prices[lower] >= prices[higher]) {
      return `${NAMES[lower]} now costs ${prices[lower] === prices[higher] ? 'the same as' : 'more than'} ${NAMES[higher]}.`;
    }
  }
  return null;
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_prices', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();

    if (body.action === 'get') return view(await planPrices(db));
    if (body.action === 'refresh') return view(await planPrices(db, { force: true }));

    // change
    const mode = currentMode();
    const { tier, amountKes } = body;
    if (mode === 'live' && (body.confirmName ?? '').toLowerCase() !== NAMES[tier].toLowerCase()) {
      throw new ApiError(400, 'confirm_name', `Type ${NAMES[tier]} to confirm a live price change.`);
    }

    // The latest known prices (fresh from Paystack), so `previous` is right.
    const before = await planPrices(db, { force: true });
    // Paystack first: if it refuses, nothing here changes (its words are shown).
    await updatePlanAmount(planCodeForTier(tier), amountKes);

    const prices = { ...before.prices, [tier]: amountKes };
    const after = await recordPriceChange(db, { mode, prices, previous: before.prices, actor: user.uid });

    waitUntil(tryWriteAudit({
      action: 'billing.price_changed', actor: user.uid, actorRole: user.role, target: `paystack/plan/${tier}`,
      before: { [tier]: before.prices[tier] }, after: { [tier]: amountKes },
      context: { requestId: log.requestId, mode, tier, source: before.source },
    }, log));
    log.info('Plan price changed', { tier, mode, from: before.prices[tier], to: amountKes });

    const warning = orderWarning(prices);
    return { ok: true, ...view(after), ...(warning ? { warning } : {}) };
  },
});
