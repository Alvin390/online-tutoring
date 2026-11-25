import { TIERS, TIER_RANK } from '@shared/constants/tiers';
import { FEATURE_LABELS, LIMIT_LABELS } from './planLabels';

/** The account card's wording — 013Fixes / 22b. Pure, so it is tested alone. */

const D = 86_400_000;
const NAIROBI_MS = 3 * 60 * 60 * 1000;

export const tierName = (tier) => TIERS[tier]?.name ?? (tier || 'No plan');

/** "Trial", "Active", "Locked", … with a Bootstrap colour. */
export function statusBadge(sub) {
  if (!sub?.status) return { text: 'No subscription', tone: 'secondary' };
  if (sub.grantedBySuperadmin) return { text: 'Gifted', tone: 'info' };
  const map = {
    trialing: ['Trial', 'primary'],
    active: [sub.cancelAtPeriodEnd ? 'Cancelling' : 'Active', sub.cancelAtPeriodEnd ? 'warning' : 'success'],
    cancelled: ['Cancelling', 'warning'],
    locked: ['Locked', 'danger'],
    expired: ['Expired', 'danger'],
    grace: ['Grace (old)', 'warning'],
    past_due: ['Payment due', 'warning'],
  };
  const [text, tone] = map[sub.status] ?? [sub.status, 'secondary'];
  return { text, tone };
}

/** "12 days left", "Ends today", or null (gifted, locked, no end). */
export function daysLeftText(sub, now = Date.now()) {
  if (!sub || sub.grantedBySuperadmin || sub.status === 'locked' || sub.status === 'expired' || sub.endsAt == null) return null;
  const days = Math.ceil((sub.endsAt - now) / D);
  if (days <= 0) return 'Ends today';
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** The end line's label, matching the school's own billing page. */
export function endLabel(sub) {
  if (sub?.status === 'trialing' && sub.nextPeriodStart == null) return 'Trial ends';
  if (sub?.renews) return 'Renews on';
  if (sub?.cancelAtPeriodEnd || sub?.status === 'cancelled') return 'Access ends on';
  return 'Paid until';
}

export const isDowngrade = (from, to) => (TIER_RANK[to] ?? 0) < (TIER_RANK[from] ?? 0);

/**
 * What a change from one plan to another takes away: the features the new
 * plan lacks, and the limits that go down. From the effective plans (the
 * superadmin's plan settings included).
 */
export function planLosses(plans, from, to) {
  const a = plans?.[from];
  const b = plans?.[to];
  if (!a || !b) return { features: [], limits: [] };
  const features = Object.keys(FEATURE_LABELS)
    .filter((k) => a.features?.[k] === true && b.features?.[k] !== true)
    .map((k) => FEATURE_LABELS[k]);
  const limits = Object.keys(LIMIT_LABELS)
    .filter((k) => Number(b.limits?.[k]) < Number(a.limits?.[k]))
    .map((k) => ({ label: LIMIT_LABELS[k], from: a.limits[k], to: b.limits[k] }));
  return { features, limits };
}

/** A date picked as yyyy-mm-dd → the end of that day in Nairobi (23:59). */
export function endOfNairobiDay(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay ?? '');
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) - NAIROBI_MS;
}
