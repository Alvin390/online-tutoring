import { formatKes } from '@utils/blockReason';

/**
 * Students on a partial payment — 006Fixes / 08. Approved on part of what
 * they owed (the server's `partialPayment` marker) and still owing (the LIVE
 * feeBalance: a later charge can raise it, a payment clears it).
 */
export const isOnPartial = (student) => Boolean(student?.partialPayment) && (Number(student?.feeBalance) || 0) > 0;

/**
 * How many are on a partial payment and what they owe, per session, from the
 * rosters the dashboard already listens to (no extra read).
 * @param {Record<string, Array<object>>} rosters
 */
export function partialSummary(rosters) {
  const out = { count: 0, owed: 0, bySession: {} };
  for (const [session, list] of Object.entries(rosters ?? {})) {
    for (const s of list ?? []) {
      if (!isOnPartial(s)) continue;
      const owed = Number(s.feeBalance) || 0;
      out.count += 1;
      out.owed += owed;
      const per = out.bySession[session] ?? { count: 0, owed: 0 };
      per.count += 1;
      per.owed += owed;
      out.bySession[session] = per;
    }
  }
  return out;
}

const toDate = (value) => (value?.toDate ? value.toDate() : value instanceof Date ? value : value ? new Date(value) : null);

/** "Paid KES 1,200 of 2,750 on 2 Nov (partial)" — the drawer's fee tab. Null when nothing is owed. */
export function partialLine(marker, balance) {
  if (!marker || !((Number(balance) || 0) > 0)) return null;
  const when = toDate(marker.at);
  const on = when && !Number.isNaN(when.getTime())
    ? ` on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}`
    : '';
  return `Paid ${formatKes(marker.paid)} of ${Number(marker.owedBefore).toLocaleString('en-KE')}${on} (partial)`;
}
