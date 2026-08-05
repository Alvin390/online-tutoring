import { describe, it, expect } from 'vitest';
import { resolveFeeAmount, computeNextDueDate } from '../../api/_lib/feeState.js';
import { formatInvoiceNumber } from '../../api/_lib/ledger.js';

describe('resolveFeeAmount', () => {
  const config = { defaultFeeByClass: { 'Grade 7': 3000, 'Grade 8': 3500 } };

  it('uses the class default', () => {
    expect(resolveFeeAmount({ student: { class: 'Grade 8' }, account: null, config })).toBe(3500);
  });

  it('prefers a per-student override', () => {
    expect(
      resolveFeeAmount({ student: { class: 'Grade 8' }, account: { feeAmount: 2000 }, config })
    ).toBe(2000);
  });

  it('honours an override of zero — a scholarship is a real amount', () => {
    expect(
      resolveFeeAmount({ student: { class: 'Grade 8' }, account: { feeAmount: 0 }, config })
    ).toBe(0);
  });

  it('returns null when the class has no configured fee', () => {
    // null, not 0. Inventing a KES 0 invoice because a class was never priced
    // hides a setup mistake behind something that looks deliberate.
    expect(resolveFeeAmount({ student: { class: 'Grade 9' }, account: null, config })).toBeNull();
  });

  it('returns null when the student has no class', () => {
    expect(resolveFeeAmount({ student: {}, account: null, config })).toBeNull();
  });

  it('ignores a fractional override rather than rounding it silently', () => {
    expect(
      resolveFeeAmount({ student: { class: 'Grade 8' }, account: { feeAmount: 2000.5 }, config })
    ).toBe(3500);
  });

  it('handles a missing config', () => {
    expect(resolveFeeAmount({ student: { class: 'Grade 8' }, account: null, config: {} })).toBeNull();
  });
});

describe('computeNextDueDate', () => {
  it('lands on the billing day plus grace', () => {
    const from = new Date('2026-03-10T00:00:00Z');
    const due = computeNextDueDate({ billingDayOfMonth: 15, gracePeriodDays: 5 }, from);
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-20');
  });

  it('rolls into next month when the billing day has passed', () => {
    const from = new Date('2026-03-20T00:00:00Z');
    const due = computeNextDueDate({ billingDayOfMonth: 15, gracePeriodDays: 0 }, from);
    expect(due.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  it('never skips February, because the day is capped at 28', () => {
    // A billing day of 30 would mean February never bills; 31 would skip seven
    // months a year. The cap is what makes this arithmetic safe.
    const from = new Date('2026-01-29T00:00:00Z');
    const due = computeNextDueDate({ billingDayOfMonth: 31, gracePeriodDays: 0 }, from);
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('handles a year boundary', () => {
    const from = new Date('2026-12-20T00:00:00Z');
    const due = computeNextDueDate({ billingDayOfMonth: 5, gracePeriodDays: 0 }, from);
    expect(due.toISOString().slice(0, 10)).toBe('2027-01-05');
  });

  it('defaults sensibly when config values are missing', () => {
    expect(computeNextDueDate({}, new Date('2026-03-10T00:00:00Z'))).toBeInstanceOf(Date);
  });
});

describe('formatInvoiceNumber', () => {
  it('zero-pads the sequence', () => {
    expect(formatInvoiceNumber('INV', 2026, 1)).toBe('INV-2026-0001');
    expect(formatInvoiceNumber('INV', 2026, 42)).toBe('INV-2026-0042');
  });

  it('does not truncate past four digits', () => {
    expect(formatInvoiceNumber('INV', 2026, 12345)).toBe('INV-2026-12345');
  });

  it('falls back to a default prefix', () => {
    expect(formatInvoiceNumber('', 2026, 1)).toBe('INV-2026-0001');
    expect(formatInvoiceNumber(null, 2026, 1)).toBe('INV-2026-0001');
  });

  it('honours a custom prefix', () => {
    expect(formatInvoiceNumber('MJ', 2026, 7)).toBe('MJ-2026-0007');
  });
});
