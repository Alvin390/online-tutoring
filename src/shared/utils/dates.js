/**
 * Date helpers — Phase 07 D2.
 *
 * No date library. `date-fns` and `dayjs` are both fine, but this phase needs
 * about eight operations and adding a dependency for them costs bundle size
 * that a tutoring app in Kenya should not pay on a mobile connection.
 *
 * KENYA HAS NO DAYLIGHT SAVING. `Africa/Nairobi` is UTC+3 year-round, and has
 * been since 1960. That single fact is what makes this file short: every "day"
 * boundary is a fixed offset, so there is no timezone database, no ambiguous
 * local times twice a year, and no DST-shifted recurrence.
 *
 * It is asserted in the tests rather than assumed, because if it ever changed
 * these calculations would drift by an hour and nobody would notice until a
 * class was missed.
 */

export const NAIROBI_OFFSET_MINUTES = 180; // UTC+3
export const NAIROBI_TZ = 'Africa/Nairobi';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value?.toMillis === 'function') return new Date(value.toMillis());
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Wall-clock fields as seen in Nairobi. */
export function nairobiParts(date) {
  const shifted = new Date(date.getTime() + NAIROBI_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Builds an instant from Nairobi wall-clock fields. */
export function fromNairobi({ year, month, day, hours = 0, minutes = 0 }) {
  return new Date(
    Date.UTC(year, month, day, hours, minutes) - NAIROBI_OFFSET_MINUTES * 60 * 1000
  );
}

/** Midnight in Nairobi on the day containing `date`. */
export function startOfDay(date) {
  const { year, month, day } = nairobiParts(date);
  return fromNairobi({ year, month, day });
}

export function endOfDay(date) {
  const { year, month, day } = nairobiParts(date);
  return new Date(fromNairobi({ year, month, day: day + 1 }).getTime() - 1);
}

export function startOfMonth(date) {
  const { year, month } = nairobiParts(date);
  return fromNairobi({ year, month, day: 1 });
}

export function endOfMonth(date) {
  const { year, month } = nairobiParts(date);
  return new Date(fromNairobi({ year, month: month + 1, day: 1 }).getTime() - 1);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMonths(date, months) {
  const { year, month, day } = nairobiParts(date);
  // Clamp the day so 31 January + 1 month is 28/29 February rather than
  // silently rolling into March.
  const target = new Date(Date.UTC(year, month + months, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  return fromNairobi({
    year: target.getUTCFullYear(),
    month: target.getUTCMonth(),
    day: Math.min(day, daysInTarget),
  });
}

export function isSameDay(a, b) {
  if (!a || !b) return false;
  const pa = nairobiParts(a);
  const pb = nairobiParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Stable `YYYY-MM-DD` key in Nairobi terms, for grouping and React keys. */
export function dayKey(date) {
  const { year, month, day } = nairobiParts(date);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The 6×7 grid for a month view, always 42 cells.
 *
 * Fixed at six weeks so the grid never changes height between months, which
 * otherwise makes the whole page jump as the teacher pages through.
 */
export function monthGrid(date, weekStartsOn = 1) {
  const first = startOfMonth(date);
  const firstWeekday = nairobiParts(first).weekday;

  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const gridStart = addDays(first, -lead);

  const { month } = nairobiParts(date);

  return Array.from({ length: 42 }, (_, i) => {
    const cellDate = addDays(gridStart, i);
    return {
      date: cellDate,
      key: dayKey(cellDate),
      inMonth: nairobiParts(cellDate).month === month,
    };
  });
}

export function formatTime(date) {
  const { hours, minutes } = nairobiParts(date);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatDayLong(date) {
  const { year, month, day, weekday } = nairobiParts(date);
  return `${WEEKDAY_FULL[weekday]} ${day} ${MONTH_LABELS[month]} ${year}`;
}

export function formatMonthYear(date) {
  const { year, month } = nairobiParts(date);
  return `${MONTH_LABELS[month]} ${year}`;
}

/** Parses `HH:MM` into minutes past midnight. Returns null if malformed. */
export function parseTimeOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
