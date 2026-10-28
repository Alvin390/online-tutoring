import { describe, it, expect, afterEach } from 'vitest';
import { formatWhen, toInputs, fromInputs, whenProblem, quickPicks } from '@features/dashboard/bulk/scheduleTime';

/** 003Fixes / 08 — scheduled-block times are Nairobi wall-clock, on any device. */

const eat = (iso) => Date.parse(`${iso}+03:00`);
const savedTz = process.env.TZ;
afterEach(() => { process.env.TZ = savedTz; });

describe('Nairobi times, whatever the device zone', () => {
  it('formats and round-trips the inputs', () => {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
      process.env.TZ = tz;
      const ms = eat('2026-11-02T18:00');
      expect(formatWhen(ms)).toBe('Mon 2 Nov, 18:00');
      expect(toInputs(ms)).toEqual({ date: '2026-11-02', time: '18:00' });
      expect(fromInputs('2026-11-02', '18:00')).toBe(ms);
    }
  });

  it('incomplete inputs are no time at all', () => {
    expect(fromInputs('', '18:00')).toBeNull();
    expect(fromInputs('2026-11-02', '6pm')).toBeNull();
  });
});

describe('whenProblem', () => {
  const now = eat('2026-10-29T10:00');
  it('at least 5 minutes ahead, at most 60 days', () => {
    expect(whenProblem(null, now)).toMatch(/Choose a date/);
    expect(whenProblem(now + 4 * 60_000, now)).toMatch(/5 minutes/);
    expect(whenProblem(now + 10 * 60_000, now)).toBeNull();
    expect(whenProblem(now + 61 * 86_400_000, now)).toMatch(/60 days/);
  });
});

describe('quickPicks', () => {
  const evening = { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' };
  it('half an hour before the next class, and tomorrow 18:00', () => {
    const picks = quickPicks(evening, eat('2026-10-29T10:00'));
    expect(picks).toEqual([
      { label: 'Before the next class', atMs: eat('2026-10-29T19:00') },
      { label: 'Tomorrow 18:00', atMs: eat('2026-10-30T18:00') },
    ]);
  });

  it('too close to (or during) today\'s class: the next one', () => {
    expect(quickPicks(evening, eat('2026-10-29T18:58'))[0].atMs).toBe(eat('2026-10-30T19:00'));
    expect(quickPicks(evening, eat('2026-10-29T20:00'))[0].atMs).toBe(eat('2026-10-30T19:00'));
  });

  it('no class schedule: only tomorrow', () => {
    expect(quickPicks(null, eat('2026-10-29T10:00')).map((p) => p.label)).toEqual(['Tomorrow 18:00']);
  });
});
