/**
 * Human-readable session times — Phase 13 / 02 D5/D8.
 *
 * One formatter for every place a session's time appears (homepage card,
 * session page header, the editor's live preview), so they can never disagree.
 *
 *   { days: [], startTime: '08:00', endTime: '12:00' }        → "8:00 AM – 12:00 PM"
 *   { days: [1, 3, 5], startTime: '16:00', endTime: '20:00' } → "Mon, Wed, Fri · 4:00 PM – 8:00 PM"
 *   { days: [1, 2, 3, 4, 5], … }                              → "Mon–Fri · …"
 *   null / missing times                                      → null (hide the line)
 *
 * `days` uses JavaScript's numbering (0 = Sunday … 6 = Saturday), matching the
 * calendar's recurrence rules. An empty list means "every day", and so does a
 * full week.
 */

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-first order for display — the school week reads Mon → Sun. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** '08:00' → '8:00 AM'; '12:00' → '12:00 PM'; '00:30' → '12:30 AM'. */
export function formatTime(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const period = hours < 12 ? 'AM' : 'PM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${match[2]} ${period}`;
}

/** [1,2,3,4,5] → 'Mon–Fri'; [1,3,5] → 'Mon, Wed, Fri'; [] or all → null. */
export function formatDays(days) {
  const set = new Set((Array.isArray(days) ? days : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 0 || set.size === 7) return null;

  const ordered = ORDER.filter((d) => set.has(d));

  // Collapse runs of three or more consecutive days (in Mon-first order).
  const parts = [];
  let run = [ordered[0]];
  for (let i = 1; i < ordered.length; i += 1) {
    const prevIdx = ORDER.indexOf(run[run.length - 1]);
    if (ORDER.indexOf(ordered[i]) === prevIdx + 1) run.push(ordered[i]);
    else {
      parts.push(run);
      run = [ordered[i]];
    }
  }
  parts.push(run);

  return parts
    .map((r) => (r.length >= 3 ? `${DAY[r[0]]}–${DAY[r[r.length - 1]]}` : r.map((d) => DAY[d]).join(', ')))
    .join(', ');
}

/** The full time line for a card, or null when there is nothing to show. */
export function formatSchedule(schedule) {
  if (!schedule) return null;
  const start = formatTime(schedule.startTime);
  const end = formatTime(schedule.endTime);
  if (!start || !end) return null;

  const days = formatDays(schedule.days);
  const times = `${start} – ${end}`;
  return days ? `${days} · ${times}` : times;
}

export default formatSchedule;
