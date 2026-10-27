import { describe, it, expect } from 'vitest';
import { nextClassWindow } from '@utils/classTime';

/**
 * 002Fixes / 08 — when a session's class next runs, in the session's own time
 * zone (Africa/Nairobi, UTC+3), whatever zone the machine is in.
 */

const eat = (iso) => Date.parse(`${iso}+03:00`); // a Nairobi wall-clock time
const evening = { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' };

describe('nextClassWindow', () => {
  it('every day: before class → today\'s window', () => {
    expect(nextClassWindow(evening, eat('2026-10-27T18:00'))).toEqual({ start: eat('2026-10-27T19:30'), end: eat('2026-10-27T21:30') });
  });

  it('during class → the window that is running', () => {
    expect(nextClassWindow(evening, eat('2026-10-27T20:15')).start).toBe(eat('2026-10-27T19:30'));
  });

  it('after class → tomorrow\'s', () => {
    expect(nextClassWindow(evening, eat('2026-10-27T22:00')).start).toBe(eat('2026-10-28T19:30'));
  });

  it('chosen days only (0 = Sunday): Tuesday 27 Oct 2026 → Wednesday for a Mon/Wed/Fri class', () => {
    expect(new Date(eat('2026-10-27T12:00')).getUTCDay()).toBe(2); // Tuesday
    const mwf = { ...evening, days: [1, 3, 5] };
    expect(nextClassWindow(mwf, eat('2026-10-27T12:00')).start).toBe(eat('2026-10-28T19:30'));
    expect(nextClassWindow({ ...evening, days: [2] }, eat('2026-10-27T12:00')).start).toBe(eat('2026-10-27T19:30'));
  });

  it('a class past midnight is still running after midnight', () => {
    const late = { days: [], tz: 'Africa/Nairobi', startTime: '23:30', endTime: '01:00' };
    expect(nextClassWindow(late, eat('2026-10-28T00:30'))).toEqual({ start: eat('2026-10-27T23:30'), end: eat('2026-10-28T01:00') });
  });

  it('the morning class at 08:30', () => {
    const morning = { days: [], tz: 'Africa/Nairobi', startTime: '08:30', endTime: '10:30' };
    expect(nextClassWindow(morning, eat('2026-10-27T07:00')).start).toBe(eat('2026-10-27T08:30'));
  });

  it('no usable start time → null', () => {
    expect(nextClassWindow(null)).toBeNull();
    expect(nextClassWindow({ startTime: '7pm' })).toBeNull();
    expect(nextClassWindow({ startTime: '25:00' })).toBeNull();
  });

  it('a missing tz means Nairobi; a missing end means two hours', () => {
    expect(nextClassWindow({ startTime: '19:30' }, eat('2026-10-27T18:00'))).toEqual({ start: eat('2026-10-27T19:30'), end: eat('2026-10-27T21:30') });
  });

  it('does not depend on the machine\'s own zone', () => {
    const before = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
        process.env.TZ = tz;
        expect(nextClassWindow(evening, eat('2026-10-27T18:00')).start).toBe(eat('2026-10-27T19:30'));
      }
    } finally {
      process.env.TZ = before;
    }
  });
});
