/**
 * Usage against the plan — 013Fixes / 12 (spec §3.3, 4.7). Soft limits: the
 * words never say "locked" or "blocked"; service always continues.
 */

export const USAGE_ROWS = [
  { key: 'activeStudents', label: 'Active learners' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'logins', label: 'Dashboard logins' },
];

/** 'ok' below 80%, 'near' from 80%, 'over' from 100%. */
export function usageLevel(percent) {
  if (percent >= 100) return 'over';
  if (percent >= 80) return 'near';
  return 'ok';
}

export const USAGE_WORDS = {
  near: "You are approaching your plan's included capacity.",
  over: "You are above your plan's included allowance. Your service continues normally. Consider upgrading.",
  loginsFull: 'Every dashboard login is in use. Contact us for more logins.',
};

/** The highest level across the rows. */
export function overallLevel(usage) {
  if (!usage) return 'ok';
  const levels = USAGE_ROWS.map((r) => usageLevel(usage.percent?.[r.key] ?? 0));
  if (levels.includes('over')) return 'over';
  if (levels.includes('near')) return 'near';
  return 'ok';
}

/** "1 Nov – 30 Nov" in Nairobi time. */
export function windowText(usage) {
  if (!usage?.windowStart) return '';
  const fmt = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
  // The window's end is the start of the next one: show the day before.
  const end = usage.windowEnd ? new Date(Date.parse(usage.windowEnd) - 1).toISOString() : null;
  return end ? `${fmt(usage.windowStart)} – ${fmt(end)}` : `from ${fmt(usage.windowStart)}`;
}
