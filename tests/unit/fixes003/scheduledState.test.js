import { describe, it, expect } from 'vitest';
import { isBlockedNow, dueScheduledBlock } from '../../../api/_lib/studentState.js';
import { projectStudent } from '../../../api/_lib/studentProjection.js';

/** 003Fixes / 07 — "blocked now": explicitly, or by a scheduled block that is due. */

const T = Date.parse('2026-11-02T15:00:00Z');
const sb = (atMs, extra = {}) => ({ scheduledBlock: { atMs, batchId: 'S1', kind: 'other', reason: 'Fee due', ...extra } });

describe('isBlockedNow', () => {
  it('blocked:true is blocked; nothing scheduled is not', () => {
    expect(isBlockedNow({ blocked: true }, T)).toBe(true);
    expect(isBlockedNow({ blocked: false }, T)).toBe(false);
    expect(isBlockedNow(null, T)).toBe(false);
  });

  it('a schedule counts from its minute, not before', () => {
    expect(isBlockedNow(sb(T + 1), T)).toBe(false);
    expect(isBlockedNow(sb(T), T)).toBe(true);
    expect(isBlockedNow(sb(T - 60_000), T)).toBe(true);
    expect(dueScheduledBlock(sb(T + 1), T)).toBeNull();
  });

  it('reads a Timestamp when atMs is missing', () => {
    expect(isBlockedNow({ scheduledBlock: { at: { toMillis: () => T - 1 } } }, T)).toBe(true);
  });
});

describe('what a due schedule shows the student', () => {
  it('the reason for a plain block; never the batch id', () => {
    const p = projectStudent(sb(Date.now() - 1000));
    expect(p).toMatchObject({ blocked: true, blockReason: 'Fee due' });
    expect(JSON.stringify(p)).not.toContain('S1');
  });

  it('a fee block not yet recorded: "recording the amount", not a balance', () => {
    const p = projectStudent(sb(Date.now() - 1000, { kind: 'fees', reason: null }));
    expect(p.blocked).toBe(true);
    expect(p.blockReason).toMatch(/recording the amount/);
    expect(p.feeBalance).toBe(0);
  });

  it('a schedule still in the future changes nothing', () => {
    expect(projectStudent(sb(Date.now() + 600_000))).toMatchObject({ blocked: false, blockReason: '' });
  });
});
