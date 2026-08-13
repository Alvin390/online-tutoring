/**
 * RFC 5545 `.ics` generation — Phase 07 D5.
 *
 * Hand-written rather than a library, for the same reason as the calendar
 * itself: the subset needed here is small, and `ics`/`ical-generator` bring
 * dependencies and opinions for output we can produce in 80 lines.
 *
 * The parts that are easy to get wrong and are handled explicitly:
 *
 *   - **Line folding.** RFC 5545 caps lines at 75 OCTETS. Long descriptions
 *     must be folded with CRLF + a single space, or strict parsers (Apple
 *     Calendar among them) reject the file.
 *   - **CRLF line endings.** Not LF. The spec requires it and some parsers are
 *     strict about it.
 *   - **Escaping.** Commas, semicolons, backslashes and newlines inside text
 *     values must be escaped, or a description containing a comma silently
 *     truncates the field.
 *   - **VTIMEZONE.** Emitted for Africa/Nairobi so recurring events land at the
 *     right local time in every client. Kenya has no DST, so it is a single
 *     STANDARD block with a fixed +0300 offset — which is why this is short.
 */

const CRLF = '\r\n';

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds to 75 octets. Counts BYTES, not characters — a description in Swahili
 * or with an emoji would otherwise overflow the limit while looking short.
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;

  while (start < bytes.length) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry a leading space
    let end = Math.min(start + limit, bytes.length);

    // Do not split a multi-byte character: back off to a lead byte boundary.
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }

    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }

  return parts[0] + parts.slice(1).map((p) => `${CRLF} ${p}`).join('');
}

/** UTC form: 20260315T060000Z */
function formatUtc(date) {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function buildRrule(recurrence) {
  if (!recurrence || recurrence.freq !== 'weekly') return null;

  const parts = ['FREQ=WEEKLY'];

  const interval = Math.max(1, Number(recurrence.interval) || 1);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);

  const byDay = Array.isArray(recurrence.byDay) ? recurrence.byDay.filter((d) => d >= 0 && d <= 6) : [];
  if (byDay.length > 0) parts.push(`BYDAY=${byDay.map((d) => BYDAY[d]).join(',')}`);

  if (recurrence.until) parts.push(`UNTIL=${formatUtc(recurrence.until)}`);

  return parts.join(';');
}

/**
 * Africa/Nairobi. One STANDARD block, no DAYLIGHT — Kenya has observed UTC+3
 * continuously since 1960.
 */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Africa/Nairobi',
  'BEGIN:STANDARD',
  'DTSTART:19600101T000000',
  'TZOFFSETFROM:+0245',
  'TZOFFSETTO:+0300',
  'TZNAME:EAT',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export function buildIcs({ events, calendarName = 'Class Calendar', domain = 'online-tutoring' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escapeText(domain)}//Class Calendar//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeText(calendarName)}`),
    'X-WR-TIMEZONE:Africa/Nairobi',
    ...VTIMEZONE,
  ];

  const stamp = formatUtc(new Date());

  for (const event of events ?? []) {
    const start = event.start ? new Date(event.start) : null;
    if (!start || Number.isNaN(start.getTime())) continue;

    const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(event.id)}@${escapeText(domain)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatUtc(start)}`);
    lines.push(`DTEND:${formatUtc(end)}`);
    lines.push(fold(`SUMMARY:${escapeText(event.title)}`));

    if (event.description) lines.push(fold(`DESCRIPTION:${escapeText(event.description)}`));

    const rrule = buildRrule(event.recurrence);
    if (rrule) lines.push(`RRULE:${rrule}`);

    const exceptions = (event.recurrenceExceptions ?? [])
      .map((value) => new Date(value))
      .filter((d) => !Number.isNaN(d.getTime()));

    if (exceptions.length > 0) {
      lines.push(`EXDATE:${exceptions.map(formatUtc).join(',')}`);
    }

    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // Trailing CRLF: the spec requires the last line to be terminated too.
  return `${lines.join(CRLF)}${CRLF}`;
}

export { escapeText, fold, formatUtc, buildRrule };
