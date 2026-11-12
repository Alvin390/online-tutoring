import { formatKes } from '@utils/blockReason';

/**
 * 007Fixes / 09 — the words and lookups behind "Mark as staff".
 */

/**
 * The same numbers registered in OTHER sessions, for "Also mark their …
 * record": not one already chosen, and not already staff.
 * @param {Array<{session, phone}>} people
 * @param {Record<string, object[]>} rosters  studentsBySession (+ staff lists)
 * @param {Record<string, string>} sessionNames
 * @returns {Array<{session, sessionName, phone, balance}>}
 */
export function otherRecords(people, rosters, sessionNames = {}) {
  const chosen = new Set(people.map((p) => `${p.session}|${p.phone}`));
  const phones = new Set(people.map((p) => p.phone));
  const found = [];
  for (const [session, list] of Object.entries(rosters ?? {})) {
    for (const record of list ?? []) {
      if (!phones.has(record.id) || record.staff === true || chosen.has(`${session}|${record.id}`)) continue;
      found.push({ session, sessionName: sessionNames[session] ?? session, phone: record.id, balance: Math.max(0, Number(record.feeBalance) || 0) });
    }
  }
  return found;
}

/** "5 marked as staff. KES 8,250 closed." */
export function markedToast({ marked, closedTotal }) {
  return `${marked} marked as staff.${closedTotal > 0 ? ` ${formatKes(closedTotal)} closed.` : ''}`;
}
