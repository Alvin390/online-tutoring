import { describe, it, expect } from 'vitest';
import { formatSchedule, formatTime, formatDays } from '@utils/formatSchedule';

// Phase 13 / 02 D8 — the homepage card's time line.
describe('formatTime', () => {
  it.each([
    ['08:00', '8:00 AM'], ['12:00', '12:00 PM'], ['00:30', '12:30 AM'],
    ['16:00', '4:00 PM'], ['23:59', '11:59 PM'], ['24:00', null], ['8:00', null], [undefined, null],
  ])('%s → %s', (input, expected) => expect(formatTime(input)).toBe(expected));
});

describe('formatDays', () => {
  it.each([
    [[], null],
    [[0, 1, 2, 3, 4, 5, 6], null],
    [[1], 'Mon'],
    [[1, 3, 5], 'Mon, Wed, Fri'],
    [[5, 1, 3], 'Mon, Wed, Fri'],
    [[1, 2, 3, 4, 5], 'Mon–Fri'],
    [[1, 2], 'Mon, Tue'],
    [[6, 0], 'Sat, Sun'],
    [[1, 2, 3, 5], 'Mon–Wed, Fri'],
  ])('%j → %s', (days, expected) => expect(formatDays(days)).toBe(expected));
});

describe('formatSchedule', () => {
  it('matches the old morning homepage line exactly', () => {
    expect(formatSchedule({ days: [], startTime: '08:00', endTime: '12:00' })).toBe('8:00 AM – 12:00 PM');
  });

  it('matches the old evening homepage line exactly', () => {
    expect(formatSchedule({ days: [], startTime: '16:00', endTime: '20:00' })).toBe('4:00 PM – 8:00 PM');
  });

  it('prefixes chosen days', () => {
    expect(formatSchedule({ days: [1, 3, 5], startTime: '16:00', endTime: '20:00' })).toBe('Mon, Wed, Fri · 4:00 PM – 8:00 PM');
  });

  it('hides the line with no schedule or missing times', () => {
    expect(formatSchedule(null)).toBeNull();
    expect(formatSchedule({ days: [1] })).toBeNull();
    expect(formatSchedule({ days: [], startTime: '08:00' })).toBeNull();
  });
});
