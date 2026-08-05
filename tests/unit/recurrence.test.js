import { describe, it, expect } from 'vitest';
import { expandOccurrences, expandAll, groupByDay, splitSeriesAt } from '@utils/recurrence';
import { dayKey, formatTime } from '@utils/dates';

/**
 * Weekly recurrence — Phase 07 D1.
 *
 * Recurrence is stored as a rule and expanded at read time, so these tests are
 * the entire correctness argument for the calendar.
 */

// 09:00 Nairobi on Monday 2 March 2026.
const MONDAY_0900 = new Date('2026-03-02T06:00:00Z');

const event = (overrides = {}) => ({
  id: 'evt1',
  title: 'Maths',
  start: MONDAY_0900,
  end: new Date(MONDAY_0900.getTime() + 60 * 60 * 1000),
  recurrence: null,
  recurrenceExceptions: [],
  ...overrides,
});

const MARCH = [new Date('2026-03-01T00:00:00Z'), new Date('2026-03-31T23:59:59Z')];

describe('single events', () => {
  it('returns one occurrence inside the window', () => {
    const result = expandOccurrences(event(), ...MARCH);
    expect(result).toHaveLength(1);
    expect(dayKey(result[0].occurrenceStart)).toBe('2026-03-02');
  });

  it('returns nothing outside the window', () => {
    expect(expandOccurrences(event(), new Date('2026-04-01'), new Date('2026-04-30'))).toHaveLength(0);
  });

  it('preserves duration', () => {
    const [occurrence] = expandOccurrences(event(), ...MARCH);
    expect(occurrence.occurrenceEnd - occurrence.occurrenceStart).toBe(60 * 60 * 1000);
  });

  it('handles an event with no end', () => {
    const [occurrence] = expandOccurrences(event({ end: null }), ...MARCH);
    expect(occurrence.occurrenceEnd.getTime()).toBe(occurrence.occurrenceStart.getTime());
  });

  it('returns nothing for a malformed event', () => {
    expect(expandOccurrences({ id: 'x', start: null }, ...MARCH)).toEqual([]);
    expect(expandOccurrences(null, ...MARCH)).toEqual([]);
  });
});

describe('weekly recurrence', () => {
  const weekly = (extra = {}) =>
    event({ recurrence: { freq: 'weekly', interval: 1, byDay: [1], ...extra } });

  it('expands every Monday in March 2026', () => {
    // 2, 9, 16, 23, 30 March.
    const result = expandOccurrences(weekly(), ...MARCH);
    expect(result.map((o) => dayKey(o.occurrenceStart))).toEqual([
      '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30',
    ]);
  });

  it('keeps the same wall-clock time all year — Kenya has no DST', () => {
    const result = expandOccurrences(weekly(), new Date('2026-01-01'), new Date('2026-12-31'));
    const times = new Set(result.map((o) => formatTime(o.occurrenceStart)));
    expect(times.size).toBe(1);
    expect([...times][0]).toBe('09:00');
  });

  it('expands a full year without drifting weekday', () => {
    const result = expandOccurrences(weekly(), new Date('2026-01-01'), new Date('2026-12-31'));
    for (const occurrence of result) {
      expect(occurrence.occurrenceStart.getUTCDay()).toBe(1);
    }
    // 2 March to 28 December inclusive.
    expect(result.length).toBeGreaterThan(40);
  });

  it('supports multiple weekdays', () => {
    const result = expandOccurrences(
      weekly({ byDay: [1, 3] }),
      new Date('2026-03-01'),
      new Date('2026-03-15')
    );
    expect(result.map((o) => dayKey(o.occurrenceStart))).toEqual([
      '2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11',
    ]);
  });

  it('supports a fortnightly interval', () => {
    const result = expandOccurrences(weekly({ interval: 2 }), ...MARCH);
    expect(result.map((o) => dayKey(o.occurrenceStart))).toEqual([
      '2026-03-02', '2026-03-16', '2026-03-30',
    ]);
  });

  it('never emits before the series start', () => {
    const result = expandOccurrences(weekly(), new Date('2026-01-01'), new Date('2026-03-31'));
    expect(result.every((o) => o.occurrenceStart >= MONDAY_0900)).toBe(true);
  });

  it('stops at `until`', () => {
    const result = expandOccurrences(
      weekly({ until: new Date('2026-03-16T23:59:59Z') }),
      ...MARCH
    );
    expect(result.map((o) => dayKey(o.occurrenceStart))).toEqual([
      '2026-03-02', '2026-03-09', '2026-03-16',
    ]);
  });

  it('defaults byDay to the start weekday when omitted', () => {
    const result = expandOccurrences(
      event({ recurrence: { freq: 'weekly', interval: 1 } }),
      ...MARCH
    );
    expect(result).toHaveLength(5);
  });

  it('ignores invalid weekday values', () => {
    const result = expandOccurrences(weekly({ byDay: [1, 9, -2] }), ...MARCH);
    expect(result).toHaveLength(5);
  });

  it('is bounded so a huge window cannot hang the UI', () => {
    const result = expandOccurrences(
      weekly(),
      new Date('2026-01-01'),
      new Date('2100-01-01')
    );
    expect(result.length).toBeLessThanOrEqual(500);
  });
});

describe('exceptions', () => {
  it('omits a cancelled occurrence without affecting the series', () => {
    const result = expandOccurrences(
      event({
        recurrence: { freq: 'weekly', interval: 1, byDay: [1] },
        recurrenceExceptions: [new Date('2026-03-16T06:00:00Z')],
      }),
      ...MARCH
    );
    expect(result.map((o) => dayKey(o.occurrenceStart))).toEqual([
      '2026-03-02', '2026-03-09', '2026-03-23', '2026-03-30',
    ]);
  });

  it('matches an exception on the day, not the exact millisecond', () => {
    // A cancelled 09:00 class must not be resurrected by a stored exception of
    // 09:00:00.001.
    const result = expandOccurrences(
      event({
        recurrence: { freq: 'weekly', interval: 1, byDay: [1] },
        recurrenceExceptions: [new Date('2026-03-16T18:30:00Z')],
      }),
      ...MARCH
    );
    expect(result.map((o) => dayKey(o.occurrenceStart))).not.toContain('2026-03-16');
  });

  it('can cancel a single non-recurring event', () => {
    const result = expandOccurrences(
      event({ recurrenceExceptions: [MONDAY_0900] }),
      ...MARCH
    );
    expect(result).toEqual([]);
  });
});

describe('occurrence keys', () => {
  it('are unique and stable across re-expansion', () => {
    const weekly = event({ recurrence: { freq: 'weekly', interval: 1, byDay: [1] } });
    const first = expandOccurrences(weekly, ...MARCH);
    const second = expandOccurrences(weekly, ...MARCH);

    expect(new Set(first.map((o) => o.key)).size).toBe(first.length);
    expect(first.map((o) => o.key)).toEqual(second.map((o) => o.key));
  });
});

describe('expandAll and groupByDay', () => {
  it('merges several events in chronological order', () => {
    const a = event({ id: 'a', start: new Date('2026-03-10T06:00:00Z') });
    const b = event({ id: 'b', start: new Date('2026-03-05T06:00:00Z') });

    const result = expandAll([a, b], ...MARCH);
    expect(result.map((o) => o.eventId)).toEqual(['b', 'a']);
  });

  it('groups by Nairobi day', () => {
    const a = event({ id: 'a', start: new Date('2026-03-10T06:00:00Z') });
    const b = event({ id: 'b', start: new Date('2026-03-10T12:00:00Z') });

    const grouped = groupByDay(expandAll([a, b], ...MARCH));
    expect(grouped.get('2026-03-10')).toHaveLength(2);
  });
});

describe('splitSeriesAt', () => {
  it('ends the original the instant before and starts the new one at the boundary', () => {
    // Omitting this is the most common calendar bug there is: editing one
    // occurrence silently rewrites every past one too.
    const boundary = new Date('2026-03-16T06:00:00Z');
    const split = splitSeriesAt(event(), boundary);

    expect(split.originalUntil.getTime()).toBe(boundary.getTime() - 1);
    expect(split.newStart.getTime()).toBe(boundary.getTime());
  });

  it('leaves past occurrences untouched', () => {
    const boundary = new Date('2026-03-16T06:00:00Z');
    const split = splitSeriesAt(event(), boundary);

    const past = expandOccurrences(
      event({ recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: split.originalUntil } }),
      ...MARCH
    );
    expect(past.map((o) => dayKey(o.occurrenceStart))).toEqual(['2026-03-02', '2026-03-09']);
  });

  it('returns null for a malformed boundary', () => {
    expect(splitSeriesAt(event(), null)).toBeNull();
  });
});
