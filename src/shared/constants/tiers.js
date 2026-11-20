/**
 * Tier definitions — shared by routing, billing UI and upgrade prompts.
 *
 * Prices are in whole KES. The client never sends an amount to the server: the
 * server looks the price up from the Paystack plan, so these values are for
 * display only. A client-supplied amount is the classic mass-assignment hole in
 * a billing flow.
 */

import { DEFAULT_PLANS, limitLines } from './plans';

export const TIER_RANK = {
  bronze: 1,
  silver: 2,
  gold: 3,
};

/**
 * Names and prices (prices change only in the pricing series). The card words
 * — tagline and bullets — come from the plan map (013Fixes / 07), with the
 * limit lines made from each plan's limits, so there is one source of truth.
 */
function cardFor(id) {
  const plan = DEFAULT_PLANS[id];
  return { tagline: plan.card.tagline, features: [...plan.card.bullets, ...limitLines(plan.limits)] };
}

export const TIERS = {
  bronze: { id: 'bronze', name: 'Bronze', rank: 1, priceKes: 4999, ...cardFor('bronze') },
  silver: { id: 'silver', name: 'Silver', rank: 2, priceKes: 7499, ...cardFor('silver') },
  gold: { id: 'gold', name: 'Gold', rank: 3, priceKes: 9999, ...cardFor('gold') },
};

export const TIER_ORDER = ['bronze', 'silver', 'gold'];

export function formatKes(amount) {
  return `KES ${Number(amount).toLocaleString('en-KE')}`;
}

export function tierAtLeast(userTierRank, requiredTier) {
  return (userTierRank ?? 0) >= (TIER_RANK[requiredTier] ?? Infinity);
}
