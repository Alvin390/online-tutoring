import { describe, it, expect } from 'vitest';
import {
  nairobiParts,
  fromNairobi,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  isSameDay,
  dayKey,
  monthGrid,
  formatTime,
  formatMonthYear,
  parseTimeOfDay,
  NAIROBI_OFFSET_MINUTES,
} from '@utils/dates';

/**
 * Date helpers — Phase 07 D2.
 */

describe('Kenya has no daylight saving', () => {
  it('is UTC+3 in January and in July alike', () => {
    // Asserted rather than assumed. This single fact is what lets the whole
    // calendar use a fixed offset instead of a timezone database — if it ever
    // changed, every calculation here would drift by an hour.
    expect(NAIROBI_OFFSET_MINUTES).toBe(180);

    const january = nairobiParts(new Date('2026-01-15T09:00:00Z'));
    const july = nairobiParts(new Date('2026-07-15T09:00:00Z'));

    expect(january.hours).toBe(12);
    expect(july.hours).toBe(12);
  });

  it('round-trips a wall-clock time through both directions', () => {
    const instant = fromNairobi({ year: 2026, month: 2, day: 15, hours: 9, minutes: 30 });
    expect(instant.toISOString()).toBe('2026-03-15T06:30:00.000Z');
    const parts = nairobiParts(instant);
    expect(parts).toMatchObject({ year: 2026, month: 2, day: 15, hours: 9, minutes: 30 });
  });
});

describe('day boundaries', () => {
  it('starts a day at Nairobi midnight, not UTC midnight', () => {
    // 01:00 UTC on 15 March is already 04:00 in Nairobi, so the day started
    // at 21:00 UTC the previous evening.
    const start = startOfDay(new Date('2026-03-15T01:00:00Z'));
    expect(start.toISOString()).toBe('2026-03-14T21:00:00.000Z');
  });

  it('ends a day one millisecond before the next', () => {
    const end = endOfDay(new Date('2026-03-15T12:00:00Z'));
    expect(end.toISOString()).toBe('2026-03-15T20:59:59.999Z');
  });

  it('treats two instants on the same Nairobi day as the same day', () => {
    expect(isSameDay(new Date('2026-03-15T21:30:00Z'), new Date('2026-03-15T05:00:00Z')))
      .toBe(false);
    expect(isSameDay(new Date('2026-03-14T21:30:00Z'), new Date('2026-03-15T05:00:00Z')))
      .toBe(true);
  });

  it('produces a stable day key', () => {
    expect(dayKey(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03-15');
    // 22:00 UTC is already the next day in Nairobi.
    expect(dayKey(new Date('2026-03-15T22:00:00Z'))).toBe('2026-03-16');
  });
});

describe('month boundaries', () => {
  it('finds the first and last instant of a month', () => {
    const mid = new Date('2026-03-15T12:00:00Z');
    expect(dayKey(startOfMonth(mid))).toBe('2026-03-01');
    expect(dayKey(endOfMonth(mid))).toBe('2026-03-31');
  });

  it('handles February in a non-leap year', () => {
    expect(dayKey(endOfMonth(new Date('2026-02-10T12:00:00Z')))).toBe('2026-02-28');
  });

  it('handles February in a leap year', () => {
    expect(dayKey(endOfMonth(new Date('2028-02-10T12:00:00Z')))).toBe('2028-02-29');
  });
});

describe('addMonths', () => {
  it('adds a month', () => {
    expect(dayKey(addMonths(new Date('2026-03-15T12:00:00Z'), 1))).toBe('2026-04-15');
  });

  it('clamps 31 January + 1 month to 28 February, not 3 March', () => {
    // The naive implementation rolls over and silently skips a month.
    expect(dayKey(addMonths(new Date('2026-01-31T12:00:00Z'), 1))).toBe('2026-02-28');
  });

  it('goes backwards', () => {
    expect(dayKey(addMonths(new Date('2026-03-15T12:00:00Z'), -1))).toBe('2026-02-15');
  });

  it('crosses a year boundary', () => {
    expect(dayKey(addMonths(new Date('2026-12-15T12:00:00Z'), 1))).toBe('2027-01-15');
  });
});

describe('monthGrid', () => {
  it('always returns exactly 42 cells', () => {
    // Fixed six weeks so the grid never changes height between months, which
    // would otherwise make the page jump as the teacher pages through.
    for (const iso of ['2026-02-01', '2026-03-01', '2026-08-01', '2028-02-01']) {
      expect(monthGrid(new Date(`${iso}T12:00:00Z`))).toHaveLength(42);
    }
  });

  it('starts the week on Monday by default', () => {
    const grid = monthGrid(new Date('2026-03-15T12:00:00Z'));
    expect(nairobiParts(grid[0].date).weekday).toBe(1);
  });

  it('marks cells outside the current month', () => {
    const grid = monthGrid(new Date('2026-03-15T12:00:00Z'));
    // 1 March 2026 is a Sunday, so a Monday-start grid leads with six February
    // days.
    expect(grid[0].inMonth).toBe(false);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it('gives every cell a unique key', () => {
    const grid = monthGrid(new Date('2026-03-15T12:00:00Z'));
    expect(new Set(grid.map((c) => c.key)).size).toBe(42);
  });
});

describe('formatting', () => {
  it('formats time in Nairobi terms', () => {
    expect(formatTime(new Date('2026-03-15T06:30:00Z'))).toBe('09:30');
  });

  it('formats the month header', () => {
    expect(formatMonthYear(new Date('2026-03-15T12:00:00Z'))).toBe('March 2026');
  });
});

describe('parseTimeOfDay', () => {
  it('parses valid times', () => {
    expect(parseTimeOfDay('09:30')).toBe(570);
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('23:59')).toBe(1439);
  });

  it('rejects malformed and out-of-range values', () => {
    for (const bad of ['24:00', '09:60', '9:5', 'abc', '', null, undefined, '09:30:00']) {
      expect(parseTimeOfDay(bad), String(bad)).toBeNull();
    }
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(dayKey(addDays(new Date('2026-03-31T12:00:00Z'), 1))).toBe('2026-04-01');
    expect(dayKey(addDays(new Date('2026-12-31T12:00:00Z'), 1))).toBe('2027-01-01');
    expect(dayKey(addDays(new Date('2026-03-01T12:00:00Z'), -1))).toBe('2026-02-28');
  });
});
