import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, fold, formatUtc, buildRrule } from '../../api/_lib/ics.js';

/**
 * RFC 5545 output — Phase 07 D5.
 *
 * The failure mode for a malformed `.ics` is silent: Apple Calendar and Google
 * Calendar simply refuse the file, or import it with fields truncated, and the
 * teacher has no idea why. So the fiddly parts get direct tests.
 */

const event = (overrides = {}) => ({
  id: 'evt1',
  title: 'Maths class',
  description: null,
  start: new Date('2026-03-02T06:00:00Z'),
  end: new Date('2026-03-02T07:00:00Z'),
  recurrence: null,
  recurrenceExceptions: [],
  ...overrides,
});

describe('structure', () => {
  it('wraps events in a VCALENDAR', () => {
    const ics = buildIcs({ events: [event()] });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('uses CRLF line endings, as the spec requires', () => {
    const ics = buildIcs({ events: [event()] });
    expect(ics).toContain('\r\n');
    // No bare LF anywhere.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('terminates the final line', () => {
    expect(buildIcs({ events: [event()] }).endsWith('\r\n')).toBe(true);
  });

  it('emits a VTIMEZONE for Africa/Nairobi with no DAYLIGHT block', () => {
    // Kenya has observed UTC+3 continuously since 1960, so a DAYLIGHT block
    // would be wrong, not merely redundant.
    const ics = buildIcs({ events: [event()] });
    expect(ics).toContain('TZID:Africa/Nairobi');
    expect(ics).toContain('TZOFFSETTO:+0300');
    expect(ics).not.toContain('BEGIN:DAYLIGHT');
  });

  it('skips malformed events rather than emitting a broken VEVENT', () => {
    const ics = buildIcs({ events: [event({ start: null }), event({ id: 'good' })] });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('handles an empty event list', () => {
    const ics = buildIcs({ events: [] });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('formatUtc', () => {
  it('produces the compact UTC form', () => {
    expect(formatUtc(new Date('2026-03-15T06:30:00Z'))).toBe('20260315T063000Z');
  });
});

describe('escaping', () => {
  it('escapes commas, semicolons and backslashes', () => {
    // An unescaped comma silently truncates the field in most parsers.
    expect(escapeText('Maths, Physics; and \\ more')).toBe('Maths\\, Physics\\; and \\\\ more');
  });

  it('escapes newlines as \\n', () => {
    expect(escapeText('line one\nline two')).toBe('line one\\nline two');
    expect(escapeText('line one\r\nline two')).toBe('line one\\nline two');
  });

  it('escapes a title containing a comma inside real output', () => {
    const ics = buildIcs({ events: [event({ title: 'Maths, Physics' })] });
    expect(ics).toContain('SUMMARY:Maths\\, Physics');
  });

  it('handles null and undefined', () => {
    expect(escapeText(null)).toBe('');
    expect(escapeText(undefined)).toBe('');
  });
});

describe('line folding', () => {
  it('leaves short lines alone', () => {
    expect(fold('SUMMARY:Short')).toBe('SUMMARY:Short');
  });

  it('folds a long line with CRLF and a leading space', () => {
    const folded = fold(`DESCRIPTION:${'a'.repeat(200)}`);
    expect(folded).toContain('\r\n ');
    for (const line of folded.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });

  it('counts BYTES, not characters', () => {
    // A description in a script with multi-byte characters would otherwise
    // overflow the 75-octet limit while looking short.
    const folded = fold(`DESCRIPTION:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });

  it('never splits a multi-byte character', () => {
    const folded = fold(`DESCRIPTION:${'🎓'.repeat(40)}`);
    // A split surrogate would decode to U+FFFD.
    expect(folded).not.toContain('�');
  });

  it('folds long descriptions in real output', () => {
    const ics = buildIcs({ events: [event({ description: 'x'.repeat(300) })] });
    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });
});

describe('RRULE', () => {
  it('returns null for a non-recurring event', () => {
    expect(buildRrule(null)).toBeNull();
    expect(buildRrule({ freq: 'monthly' })).toBeNull();
  });

  it('builds a simple weekly rule', () => {
    expect(buildRrule({ freq: 'weekly', byDay: [1] })).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('maps every weekday correctly', () => {
    expect(buildRrule({ freq: 'weekly', byDay: [0, 1, 2, 3, 4, 5, 6] }))
      .toBe('FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA');
  });

  it('includes an interval above one', () => {
    expect(buildRrule({ freq: 'weekly', interval: 2, byDay: [1] }))
      .toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
  });

  it('omits an interval of one', () => {
    expect(buildRrule({ freq: 'weekly', interval: 1, byDay: [1] })).not.toContain('INTERVAL');
  });

  it('includes UNTIL in UTC form', () => {
    expect(buildRrule({ freq: 'weekly', byDay: [1], until: new Date('2026-06-30T20:59:59Z') }))
      .toContain('UNTIL=20260630T205959Z');
  });

  it('drops invalid weekday values', () => {
    expect(buildRrule({ freq: 'weekly', byDay: [1, 9, -3] })).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('appears in real output', () => {
    const ics = buildIcs({
      events: [event({ recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3] } })],
    });
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  });
});

describe('EXDATE', () => {
  it('emits cancelled occurrences', () => {
    const ics = buildIcs({
      events: [
        event({
          recurrence: { freq: 'weekly', byDay: [1] },
          recurrenceExceptions: [new Date('2026-03-16T06:00:00Z')],
        }),
      ],
    });
    expect(ics).toContain('EXDATE:20260316T060000Z');
  });

  it('omits EXDATE when there are no exceptions', () => {
    expect(buildIcs({ events: [event()] })).not.toContain('EXDATE');
  });

  it('ignores malformed exception dates', () => {
    const ics = buildIcs({
      events: [event({ recurrenceExceptions: ['not-a-date', new Date('2026-03-16T06:00:00Z')] })],
    });
    expect(ics).toContain('EXDATE:20260316T060000Z');
  });
});
