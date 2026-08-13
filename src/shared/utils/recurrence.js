import { toDate, addDays, nairobiParts, fromNairobi, dayKey } from './dates';

/**
 * Weekly recurrence — Phase 07 D1.
 *
 * RECURRENCE IS STORED AS A RULE, NOT AS EXPANDED ROWS. A weekly class for a
 * year is ONE document, not 52. Occurrences are computed at read time for the
 * requested window only.
 *
 * That choice is what makes "edit this and all future occurrences" tractable:
 * with expanded rows you would have to find and rewrite 40 documents and hope
 * nothing failed halfway. With a rule you split it into two rules.
 *
 * Deliberately limited to `freq: 'weekly'` with `interval` and `byDay`. Full
 * RFC 5545 is a large surface — BYSETPOS, BYMONTHDAY, EXDATE semantics, leap
 * handling — with poor return here, because a tutoring timetable is weekly. The
 * field name accommodates monthly if that ever changes.
 *
 * Kenya has no DST, so a weekly rule never shifts by an hour. See dates.js.
 */

const MAX_OCCURRENCES = 500;

/**
 * @param {object} event      needs `start`, `end`, optional `recurrence`,
 *                            optional `recurrenceExceptions`
 * @param {Date} windowStart
 * @param {Date} windowEnd
 * @returns {Array<{occurrenceStart: Date, occurrenceEnd: Date, key: string,
 *                  isException: false, eventId: string}>}
 */
export function expandOccurrences(event, windowStart, windowEnd) {
  const start = toDate(event?.start);
  if (!start) return [];

  const end = toDate(event?.end) ?? start;
  const durationMs = Math.max(0, end.getTime() - start.getTime());

  const rule = event.recurrence;

  // Exceptions are stored as instants; compare on the Nairobi day so a
  // cancelled 09:00 class is not resurrected by a rule that says 09:00:00.001.
  const exceptions = new Set(
    (event.recurrenceExceptions ?? [])
      .map((value) => toDate(value))
      .filter(Boolean)
      .map((date) => dayKey(date))
  );

  const emit = (occurrenceStart) => ({
    eventId: event.id,
    occurrenceStart,
    occurrenceEnd: new Date(occurrenceStart.getTime() + durationMs),
    // Occurrence-stable key, so React does not tear down and rebuild rows every
    // time the window is re-expanded.
    key: `${event.id}:${occurrenceStart.getTime()}`,
    isException: false,
  });

  // ---- Single event.
  if (!rule || rule.freq !== 'weekly') {
    if (start > windowEnd || new Date(start.getTime() + durationMs) < windowStart) return [];
    if (exceptions.has(dayKey(start))) return [];
    return [emit(start)];
  }

  // ---- Weekly rule.
  const interval = Math.max(1, Number(rule.interval) || 1);
  const until = toDate(rule.until);

  // byDay defaults to the weekday the series starts on, so a rule that omits it
  // still means something sensible rather than nothing.
  const byDay = Array.isArray(rule.byDay) && rule.byDay.length > 0
    ? [...new Set(rule.byDay.map(Number).filter((d) => d >= 0 && d <= 6))].sort()
    : [nairobiParts(start).weekday];

  if (byDay.length === 0) return [];

  const startParts = nairobiParts(start);
  const hardEnd = until && until < windowEnd ? until : windowEnd;
  if (start > hardEnd) return [];

  // Anchor on the Sunday of the series' first week, so "every 2 weeks" counts
  // whole weeks rather than drifting with whichever weekday we happened to
  // start iterating from.
  const seriesWeekStart = addDays(
    fromNairobi({ year: startParts.year, month: startParts.month, day: startParts.day }),
    -startParts.weekday
  );

  const results = [];
  let cursor = seriesWeekStart;
  let weekIndex = 0;
  let guard = 0;

  while (cursor <= hardEnd && results.length < MAX_OCCURRENCES && guard < 5000) {
    guard += 1;

    if (weekIndex % interval === 0) {
      for (const weekday of byDay) {
        const dayDate = addDays(cursor, weekday);
        const parts = nairobiParts(dayDate);

        const occurrenceStart = fromNairobi({
          year: parts.year,
          month: parts.month,
          day: parts.day,
          hours: startParts.hours,
          minutes: startParts.minutes,
        });

        if (occurrenceStart < start) continue;
        if (until && occurrenceStart > until) continue;

        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        if (occurrenceEnd < windowStart || occurrenceStart > windowEnd) continue;
        if (exceptions.has(dayKey(occurrenceStart))) continue;

        results.push(emit(occurrenceStart));
      }
    }

    cursor = addDays(cursor, 7);
    weekIndex += 1;
  }

  return results.sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

/** Expands many events into one sorted list for a window. */
export function expandAll(events, windowStart, windowEnd) {
  const all = [];
  for (const event of events ?? []) {
    all.push(...expandOccurrences(event, windowStart, windowEnd).map((o) => ({ ...o, event })));
  }
  return all.sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

/** Groups expanded occurrences by Nairobi day, for the month grid. */
export function groupByDay(occurrences) {
  const map = new Map();
  for (const occurrence of occurrences) {
    const key = dayKey(occurrence.occurrenceStart);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(occurrence);
  }
  return map;
}

/**
 * Splits a series for a "this and future occurrences" edit.
 *
 * Returns the `until` to stamp on the original rule and the `start` for the new
 * one. Omitting this is the most common calendar bug there is: editing one
 * occurrence silently rewrites every past one too, and a teacher discovers it
 * when last term's timetable changes under them.
 */
export function splitSeriesAt(event, occurrenceStart) {
  const boundary = toDate(occurrenceStart);
  if (!boundary) return null;

  return {
    // The original series stops the day before this occurrence.
    originalUntil: new Date(boundary.getTime() - 1),
    // The new series begins at it.
    newStart: boundary,
  };
}

export { MAX_OCCURRENCES };
