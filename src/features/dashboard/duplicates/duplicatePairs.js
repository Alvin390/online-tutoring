import { findDuplicateGroups, matchReasons } from '@utils/duplicates';

/**
 * Possible duplicates, from a roster already in memory — 003Fixes / 13.
 *
 * Every pair the rule finds (the same code as the server), plus any record
 * that registration linked to another (`duplicateOf`, kept after approval so
 * the teacher still sees the pair) — minus pairs the teacher kept. Cached per
 * roster ARRAY, like the search index: the listener hands over a new array
 * whenever anything changes, so this runs once per snapshot, never per render.
 */

const cache = new WeakMap();
const phoneOf = (s) => s?.parentPhone ?? s?.id ?? '';
const kept = (a, b) => (a?.duplicateKeep ?? []).includes(phoneOf(b)) || (b?.duplicateKeep ?? []).includes(phoneOf(a));

/** @returns {Array<{ key: string, a: object, b: object, reasons: string[] }>} */
export function duplicatePairs(students) {
  const list = Array.isArray(students) ? students : [];
  const hit = cache.get(list);
  if (hit) return hit;

  const pairs = [];
  const seen = new Set();
  const add = (a, b, reasons) => {
    const [x, y] = phoneOf(a) < phoneOf(b) ? [a, b] : [b, a];
    const key = `${phoneOf(x)}|${phoneOf(y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ key, a: x, b: y, reasons });
  };
  for (const group of findDuplicateGroups(list)) for (const p of group.pairs) add(p.a, p.b, p.reasons);

  // Linked at registration but no longer matching by rule (e.g. the receipt
  // was edited): still a pair until the teacher decides.
  const linked = list.filter((s) => s?.duplicateOf);
  if (linked.length) {
    const byPhone = new Map(list.map((s) => [phoneOf(s), s]));
    for (const s of linked) {
      const other = byPhone.get(s.duplicateOf);
      if (!other || other === s || kept(s, other)) continue;
      const reasons = matchReasons(s, other);
      add(s, other, reasons.length ? reasons : ['linked']);
    }
  }

  cache.set(list, pairs);
  return pairs;
}

/** The phones in any pair, for the "Possible duplicate" status chip. */
export function duplicatePhoneSet(students) {
  const set = new Set();
  for (const p of duplicatePairs(students)) {
    set.add(phoneOf(p.a));
    set.add(phoneOf(p.b));
  }
  return set;
}

/** Pairs across every loaded session: [{ session, ...pair }]. */
export function pairsAcross(rosters) {
  const out = [];
  for (const [session, list] of Object.entries(rosters ?? {})) {
    for (const pair of duplicatePairs(list)) out.push({ session, ...pair });
  }
  return out;
}

export const suffixOf = (phone) => `…${String(phone ?? '').replace(/\D/g, '').slice(-3)}`;

/** "Same receipt", "Same M-Pesa code", "Numbers 1–2 digits apart". */
export function reasonLabels(reasons) {
  return (reasons ?? []).map((r) => ({
    receipt: 'Same receipt',
    code: 'Same M-Pesa code',
    number: 'Numbers 1–2 digits apart',
    linked: 'Linked when registering',
  }[r] ?? r));
}

/** What a held registration matched, for the approval list. */
export function matchedLine(held, original) {
  if (!original) return `Possible duplicate of a registration with a number ending ${suffixOf(held?.duplicateOf)}`;
  const reasons = matchReasons(held, original);
  const what = reasons.includes('receipt') ? 'Same name, class and receipt'
    : reasons.includes('code') ? 'Same name, class and M-Pesa code'
      : 'Same name and class';
  const tail = reasons.length === 1 && reasons[0] === 'number' ? ', numbers 1–2 digits apart' : '';
  return `${what} as ${original.studentName} (number ending ${suffixOf(phoneOf(original))})${tail}`;
}
