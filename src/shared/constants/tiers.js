/**
 * Tier definitions — shared by routing, billing UI and upgrade prompts.
 *
 * Prices are in whole KES. The client never sends an amount to the server: the
 * server looks the price up from the Paystack plan, so these values are for
 * display only. A client-supplied amount is the classic mass-assignment hole in
 * a billing flow.
 */

export const TIER_RANK = {
  bronze: 1,
  silver: 2,
  gold: 3,
};

export const TIERS = {
  bronze: {
    id: 'bronze',
    name: 'Bronze',
    rank: 1,
    priceKes: 4999,
    tagline: 'Everything you need to run your classes',
    features: [
      'Student management',
      'Zoom and Google Meet class links',
      'Block and unblock students',
      'Private student notes',
    ],
  },
  silver: {
    id: 'silver',
    name: 'Silver',
    rank: 2,
    priceKes: 7499,
    tagline: 'Track fees and plan your term',
    features: [
      'Everything in Bronze',
      'Fee ledger and invoicing',
      'In-app calendar',
      'WhatsApp broadcast to all students',
    ],
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    rank: 3,
    priceKes: 9999,
    tagline: 'Get paid in-app and message precisely',
    features: [
      'Everything in Silver',
      'WhatsApp documents and photos',
      'Individual and class-filtered messaging',
      'M-Pesa fee payments straight to your till',
    ],
  },
};

export const TIER_ORDER = ['bronze', 'silver', 'gold'];

export function formatKes(amount) {
  return `KES ${Number(amount).toLocaleString('en-KE')}`;
}

export function tierAtLeast(userTierRank, requiredTier) {
  return (userTierRank ?? 0) >= (TIER_RANK[requiredTier] ?? Infinity);
}
