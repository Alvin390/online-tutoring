import { nairobiParts, fromNairobi, WEEKDAY_LABELS, MONTH_LABELS } from '@utils/dates';
import { nextClassWindow } from '@utils/classTime';

/**
 * Times for scheduled blocks — 003Fixes / 08. Always Nairobi wall-clock time
 * (the class's own time), whatever the device's time zone.
 */

export const MIN_LEAD_MS = 5 * 60_000;
export const MAX_LEAD_MS = 60 * 24 * 60 * 60_000;
const pad = (n) => String(n).padStart(2, '0');

/** "Sun 2 Nov, 18:00" */
export function formatWhen(ms) {
  const p = nairobiParts(new Date(ms));
  return `${WEEKDAY_LABELS[p.weekday]} ${p.day} ${MONTH_LABELS[p.month].slice(0, 3)}, ${pad(p.hours)}:${pad(p.minutes)}`;
}

/** "Sun 18:00" — for the row tag. */
export function formatShortWhen(ms) {
  const p = nairobiParts(new Date(ms));
  return `${WEEKDAY_LABELS[p.weekday]} ${pad(p.hours)}:${pad(p.minutes)}`;
}

/** The date and time inputs' values for an instant. */
export function toInputs(ms) {
  const p = nairobiParts(new Date(ms));
  return { date: `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`, time: `${pad(p.hours)}:${pad(p.minutes)}` };
}

/** The instant the inputs describe (Nairobi), or null if incomplete. */
export function fromInputs(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const t = /^(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!d || !t) return null;
  return fromNairobi({ year: Number(d[1]), month: Number(d[2]) - 1, day: Number(d[3]), hours: Number(t[1]), minutes: Number(t[2]) }).getTime();
}

/** Why a time cannot be used, or null. */
export function whenProblem(ms, now = Date.now()) {
  if (ms == null) return 'Choose a date and a time.';
  if (ms < now + MIN_LEAD_MS) return 'Choose a time at least 5 minutes from now.';
  if (ms > now + MAX_LEAD_MS) return 'Choose a time within the next 60 days.';
  return null;
}

/**
 * Suggested times: half an hour before the session's next class (or the one
 * after, if that is too close), and tomorrow at 18:00.
 */
export function quickPicks(schedule, now = Date.now()) {
  const picks = [];
  const before = (window) => (window ? window.start - 30 * 60_000 : null);
  let target = before(nextClassWindow(schedule, now));
  if (target != null && target < now + MIN_LEAD_MS + 60_000) {
    const current = nextClassWindow(schedule, now);
    target = before(nextClassWindow(schedule, current.end + 60_000));
  }
  if (target != null) picks.push({ label: 'Before the next class', atMs: target });
  const today = nairobiParts(new Date(now));
  const tomorrow = fromNairobi({ year: today.year, month: today.month, day: today.day + 1, hours: 18, minutes: 0 }).getTime();
  picks.push({ label: 'Tomorrow 18:00', atMs: tomorrow });
  return picks;
}
