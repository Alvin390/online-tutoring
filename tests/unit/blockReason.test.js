import { describe, it, expect } from 'vitest';
import { resolveBlockReason, shouldAutoUnblock } from '@utils/blockReason';

/**
 * Derived block reason — Phase 06 D5.
 *
 * The most important behavioural rule in the phase. The paywall message is
 * computed from the live balance at render time, never stored — so it cannot go
 * stale across an unblock/re-block cycle, and it updates itself when a student
 * pays part of what they owe.
 */

const student = (overrides = {}) => ({
  blocked: true,
  blockReason: '',
  feeBalance: 0,
  ...overrides,
});

const opts = { feesEnabled: true };

describe('balance-derived message', () => {
  it('reads the live balance', () => {
    const result = resolveBlockReason(student({ feeBalance: 1500 }), opts);
    expect(result.balanceLine).toBe('Balance of KES 1,500 not paid');
  });

  it('formats thousands separators', () => {
    expect(resolveBlockReason(student({ feeBalance: 12500 }), opts).balanceLine)
      .toBe('Balance of KES 12,500 not paid');
  });

  it('updates itself when a partial payment lands', () => {
    // Pays 500 of 1,500 while blocked — no teacher action, message changes.
    const before = resolveBlockReason(student({ feeBalance: 1500 }), opts);
    const after = resolveBlockReason(student({ feeBalance: 1000 }), opts);
    expect(before.balanceLine).toContain('1,500');
    expect(after.balanceLine).toContain('1,000');
  });

  it('regenerates identically after an unblock and re-block', () => {
    // It was never a stored string, so there is nothing to go stale.
    const first = resolveBlockReason(student({ feeBalance: 3000 }), opts);
    const unblocked = resolveBlockReason(student({ blocked: false, feeBalance: 3000 }), opts);
    const reblocked = resolveBlockReason(student({ feeBalance: 3000 }), opts);

    expect(unblocked.blocked).toBe(false);
    expect(reblocked.balanceLine).toBe(first.balanceLine);
  });
});

describe('zero and negative balances', () => {
  it('never renders "Balance of KES 0"', () => {
    const result = resolveBlockReason(student({ feeBalance: 0, blockReason: 'Disruptive' }), opts);
    expect(result.balanceLine).toBeNull();
    expect(result.lines).toEqual(['Disruptive']);
  });

  it('treats a credit balance as not owing', () => {
    // A negative balance means the student paid in advance. Rendering that as
    // a debt would be actively wrong.
    const result = resolveBlockReason(student({ feeBalance: -500, blockReason: 'Disruptive' }), opts);
    expect(result.balanceLine).toBeNull();
  });

  it('handles a missing or malformed balance', () => {
    expect(resolveBlockReason(student({ feeBalance: undefined }), opts).balanceLine).toBeNull();
    expect(resolveBlockReason(student({ feeBalance: 'lots' }), opts).balanceLine).toBeNull();
    expect(resolveBlockReason(student({ feeBalance: NaN }), opts).balanceLine).toBeNull();
  });
});

describe('custom reason and balance together', () => {
  it('shows the balance first — it is the actionable line', () => {
    const result = resolveBlockReason(
      student({ feeBalance: 1500, blockReason: 'Also missing three sessions' }),
      opts
    );
    expect(result.lines).toEqual([
      'Balance of KES 1,500 not paid',
      'Also missing three sessions',
    ]);
  });

  it('shows only the custom reason when nothing is owed', () => {
    const result = resolveBlockReason(student({ feeBalance: 0, blockReason: 'Behaviour' }), opts);
    expect(result.lines).toEqual(['Behaviour']);
  });

  it('ignores a whitespace-only custom reason', () => {
    const result = resolveBlockReason(student({ feeBalance: 1500, blockReason: '   ' }), opts);
    expect(result.lines).toHaveLength(1);
  });

  it('always says something when blocked with no reason and no balance', () => {
    const result = resolveBlockReason(student({ feeBalance: 0 }), opts);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('contact your teacher');
  });
});

describe('fees flag off', () => {
  it('suppresses the balance line entirely', () => {
    // Disabling the feature must not leave a balance message on a screen the
    // teacher can no longer see or change.
    const result = resolveBlockReason(
      student({ feeBalance: 1500, blockReason: 'Fees outstanding' }),
      { feesEnabled: false }
    );
    expect(result.balanceLine).toBeNull();
    expect(result.lines).toEqual(['Fees outstanding']);
  });
});

describe('not blocked', () => {
  it('returns no lines at all', () => {
    const result = resolveBlockReason(student({ blocked: false, feeBalance: 5000 }), opts);
    expect(result.blocked).toBe(false);
    expect(result.lines).toEqual([]);
  });

  it('handles a null student', () => {
    expect(resolveBlockReason(null, opts).blocked).toBe(false);
  });

  it('does not treat a truthy non-true blocked as blocked', () => {
    expect(resolveBlockReason(student({ blocked: 'yes' }), opts).blocked).toBe(false);
  });
});

describe('partial payment rule', () => {
  it('does NOT unblock on a partial payment', () => {
    // Owes 3,000, pays 1,500, balance 1,500 — stays blocked.
    expect(shouldAutoUnblock(1500)).toBe(false);
  });

  it('unblocks at exactly zero', () => {
    expect(shouldAutoUnblock(0)).toBe(true);
  });

  it('unblocks on a credit balance', () => {
    expect(shouldAutoUnblock(-200)).toBe(true);
  });
});

describe('client and server implementations agree', () => {
  it('produces identical output across a corpus', async () => {
    const server = await import('../../api/_lib/feeState.js');

    const corpus = [
      student({ feeBalance: 1500 }),
      student({ feeBalance: 0, blockReason: 'Behaviour' }),
      student({ feeBalance: 1500, blockReason: 'Also late' }),
      student({ blocked: false, feeBalance: 900 }),
      student({ feeBalance: -300 }),
      student({ feeBalance: undefined }),
      null,
    ];

    for (const s of corpus) {
      expect(server.resolveBlockReason(s, opts)).toEqual(resolveBlockReason(s, opts));
    }
  });
});
