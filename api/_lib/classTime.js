/**
 * Server copy of src/shared/utils/classTime.js — 002Fixes / 09.
 *
 * The API is a separate build (no Vite aliases), so the pre-class email keeps
 * its own copy, exactly like DEFAULT_CLASSES in sessions.js.
 * tests/unit/fixes002/classTime.test.js asserts the two give the same answers.
 * Change both or neither.
 */
/**
 * When a session's class next runs — 002Fixes / 08.
 *
 * Pure, for the dashboard's "class starts in 25 min — 4 students waiting"
 * banner. The server's pre-class email (002Fixes / 09) needs the same answer
 * and keeps an identical copy in api/_lib/classTime.js (the API is a separate
 * build with no aliases); tests/unit/fixes002/classTime.test.js asserts the
 * two agree.
 *
 * schedule: { days, tz, startTime: 'HH:MM', endTime: 'HH:MM' }, as stored on a
 * session. `days` uses 0 = Sunday … 6 = Saturday; an empty list means every
 * day (formatSchedule.js, api/_lib/sessions.js). An end before the start runs
 * past midnight.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_TZ = 'Africa/Nairobi';
const DAY_MS = 86_400_000;

/** The wall-clock date and weekday in `tz` at instant `ms`. */
function localDate(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday };
}

/** Offset of `tz` from UTC at instant `ms`, in ms. */
function offsetAt(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time in `tz` happens. */
function atLocal({ y, m, d }, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz); // a second pass settles a DST edge
}

/**
 * The class window running now, or the next one: { start, end } in ms, or
 * null when the schedule has no usable start time.
 */
export function nextClassWindow(schedule, now = Date.now()) {
  const start = HHMM.exec(String(schedule?.startTime ?? ''));
  if (!start) return null;
  const end = HHMM.exec(String(schedule?.endTime ?? ''));
  const tz = schedule?.tz || DEFAULT_TZ;
  const days = Array.isArray(schedule?.days) ? schedule.days : [];

  // Yesterday first: a class that runs past midnight may still be on.
  for (let offset = -1; offset <= 7; offset += 1) {
    const date = localDate(now + offset * DAY_MS, tz);
    if (days.length > 0 && !days.includes(date.weekday)) continue;
    const startMs = atLocal(date, Number(start[1]), Number(start[2]), tz);
    let endMs = end ? atLocal(date, Number(end[1]), Number(end[2]), tz) : startMs + 2 * 3600_000;
    if (endMs <= startMs) endMs += DAY_MS;
    if (endMs > now) return { start: startMs, end: endMs };
  }
  return null;
}
