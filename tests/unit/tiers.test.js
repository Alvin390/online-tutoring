import { describe, it, expect } from 'vitest';
import { TIER_RANK, TIERS, TIER_ORDER, tierAtLeast, formatKes } from '@shared/constants/tiers';

describe('tier ranking', () => {
  it('orders bronze < silver < gold', () => {
    expect(TIER_RANK.bronze).toBeLessThan(TIER_RANK.silver);
    expect(TIER_RANK.silver).toBeLessThan(TIER_RANK.gold);
  });

  it('treats a missing tier as rank 0, below every paid tier', () => {
    expect(tierAtLeast(0, 'bronze')).toBe(false);
    expect(tierAtLeast(undefined, 'bronze')).toBe(false);
  });

  it('satisfies a lower requirement from a higher tier', () => {
    expect(tierAtLeast(TIER_RANK.gold, 'bronze')).toBe(true);
    expect(tierAtLeast(TIER_RANK.gold, 'silver')).toBe(true);
    expect(tierAtLeast(TIER_RANK.silver, 'gold')).toBe(false);
  });

  it('refuses an unknown tier rather than defaulting to allowed', () => {
    expect(tierAtLeast(TIER_RANK.gold, 'platinum')).toBe(false);
  });

  it('keeps rank consistent between TIER_RANK and the TIERS table', () => {
    for (const id of TIER_ORDER) {
      expect(TIERS[id].rank).toBe(TIER_RANK[id]);
    }
  });

  it('matches the agreed prices', () => {
    expect(TIERS.bronze.priceKes).toBe(4999);
    expect(TIERS.silver.priceKes).toBe(7499);
    expect(TIERS.gold.priceKes).toBe(9999);
  });
});

describe('formatKes', () => {
  it('formats with thousands separators', () => {
    expect(formatKes(4999)).toBe('KES 4,999');
    expect(formatKes(9999)).toBe('KES 9,999');
  });

  it('formats zero', () => {
    expect(formatKes(0)).toBe('KES 0');
  });
});
