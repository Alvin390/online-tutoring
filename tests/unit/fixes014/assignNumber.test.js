import { describe, it, expect } from 'vitest';
import { numberCandidates, CANDIDATES_PER_ROUND } from '../../../api/_lib/assignNumber.js';
import { numberProblem } from '../../../api/_lib/admissionNumber.js';

/**
 * 014Fixes / 00 — the numbers a school gives: 4 digits (leading zeros kept),
 * never an easy one, no repeats in a round.
 */

describe('numberCandidates', () => {
  it('a round of distinct 4-digit strings, none easy', () => {
    for (let i = 0; i < 200; i += 1) {
      const round = numberCandidates();
      expect(round).toHaveLength(CANDIDATES_PER_ROUND);
      expect(new Set(round).size).toBe(round.length);
      for (const n of round) {
        expect(n).toMatch(/^\d{4}$/);
        expect(numberProblem(n)).toBeNull();
      }
    }
  });

  it('keeps leading zeros and skips easy and repeated draws', () => {
    // 1234 (easy), 42 twice, 1111 (easy), then 7, 9001.
    const draws = [1234, 42, 42, 1111, 7, 9001];
    const random = () => draws.shift() ?? 5555;
    expect(numberCandidates(3, random)).toEqual(['0042', '0007', '9001']);
  });

  it('spreads across the range (not stuck at one end)', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) for (const n of numberCandidates()) seen.add(n[0]);
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });
});
