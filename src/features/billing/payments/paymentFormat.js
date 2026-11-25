import { TIERS } from '@shared/constants/tiers';

/** 013Fixes / 21 — how a payment reads in both lists (Nairobi dates). */

const METHOD_LABELS = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank', card: 'Card' };

const day = (ms) => new Date(ms).toLocaleDateString('en-KE', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
});

export const methodLabel = (method) => METHOD_LABELS[method] ?? (method || '—');
export const tierLabel = (tier) => TIERS[tier]?.name ?? (tier || '—');
export const paidOn = (ms) => (ms == null ? '—' : day(ms));
export const amountText = (kes) => (kes == null ? '—' : `KES ${Number(kes).toLocaleString('en-KE')}`);

/** "10 Dec 2026 – 10 Jan 2027", or "—" when it wasn't kept (older payments). */
export function periodText(from, to) {
  if (from == null || to == null) return '—';
  return `${day(from)} – ${day(to)}`;
}
