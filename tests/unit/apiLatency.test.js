import { describe, it, expect } from 'vitest';
import { percentile, summarise } from '../../scripts/perf/apiLatency.mjs';

// Phase 13 / 01 D3. Percentiles are what every later phase is judged on, so the
// arithmetic is pinned (nearest-rank method).
describe('apiLatency percentiles', () => {
  const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('uses nearest rank', () => {
    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });

  it('summarises unsorted input', () => {
    const s = summarise([30, 10, 20]);
    expect(s).toEqual({ n: 3, p50: 20, p75: 30, p95: 30, p99: 30, max: 30 });
  });
});
