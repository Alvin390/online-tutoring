import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import SchoolPayments from '@/features/billing/payments/SchoolPayments';
import PaymentHistory from '@/features/admin/components/PaymentHistory';

/**
 * 013Fixes / 21 — the two payment lists. The school's: date, amount,
 * method, package, the period covered; no code column. The superadmin's:
 * the code, the note and where it came from; "Show more" pages; the
 * fill-in of older in-app payments is a check first, then "Fill in N".
 */

const api = vi.hoisted(() => ({ school: null, all: null, backfill: null }));
vi.mock('@services/api/billing', () => ({ getSchoolPayments: (...a) => api.school(...a) }));
vi.mock('@services/api/adminBilling', () => ({
  listAllPayments: (...a) => api.all(...a),
  backfillPayments: (...a) => api.backfill(...a),
}));

const dec10 = Date.parse('2026-12-10T06:00:00Z');
const jan10 = Date.parse('2027-01-10T06:00:00Z');
const row = (id, extra = {}) => ({ id, createdAt: dec10, amountKes: 5000, method: 'mpesa', tier: 'gold', periodFrom: dec10, periodTo: jan10, ...extra });

beforeEach(() => {
  api.school = vi.fn().mockResolvedValue({ items: [row('a')], nextCursor: null });
  api.all = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  api.backfill = vi.fn();
});
afterEach(() => { cleanup(); });

const flush = () => act(async () => {});

describe('the school\'s payments', () => {
  it('date, amount, method, package and period; no code', async () => {
    render(<SchoolPayments />);
    await flush();
    const table = screen.getByTestId('school-payments');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Date', 'Amount', 'Method', 'Package', 'Covers']);
    const cells = within(table).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['10 Dec 2026', 'KES 5,000', 'M-Pesa', 'Gold', '10 Dec 2026 – 10 Jan 2027']);
  });

  it('pages with "Show more"; an older payment without a period shows a dash', async () => {
    api.school.mockResolvedValueOnce({ items: [row('a')], nextCursor: dec10 })
      .mockResolvedValueOnce({ items: [row('b', { method: 'card', periodFrom: null, periodTo: null })], nextCursor: null });
    render(<SchoolPayments />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show more' })); });
    expect(api.school).toHaveBeenLastCalledWith(dec10);
    const rows = within(screen.getByTestId('school-payments')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toMatch(/Card.*—$/);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('none yet', async () => {
    api.school.mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<SchoolPayments />);
    await flush();
    expect(screen.getByTestId('no-payments').textContent).toBe('No payments yet.');
  });
});

describe('the superadmin\'s payments', () => {
  it('the code, the note and where it came from', async () => {
    api.all.mockResolvedValueOnce({ items: [
      row('m', { code: 'QXY1Z2W3V4', note: 'Paid to owner', source: 'manual', kind: 'trial_payment' }),
      row('p', { method: 'card', code: null, note: null, source: 'paystack', backfilled: true }),
    ], nextCursor: null });
    render(<PaymentHistory />);
    await flush();
    const rows = within(screen.getByTestId('all-payments')).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/QXY1Z2W3V4.*Gold \(trial\).*Recorded.*Paid to owner/);
    expect(rows[2].textContent).toMatch(/Card.*In the app \(filled in\)/);
  });

  it('fill-in: a check first (counts only), then "Fill in N", then the list again', async () => {
    api.backfill.mockResolvedValueOnce({ ok: true, applied: false, charges: 4, missing: 3, settled: 0 })
      .mockResolvedValueOnce({ ok: true, applied: true, charges: 4, missing: 3, written: 3, skipped: 0, failed: 0, notVerifiable: 0, notSuccessful: 0, remaining: 0 });
    render(<PaymentHistory />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    expect(api.backfill).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('backfill-check').textContent).toBe('4 in-app payments found; 3 not in the list yet.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fill in 3' })); });
    expect(api.backfill).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('backfill-check').textContent).toBe('Filled in 3. All done.');
    expect(api.all).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /Fill in/ })).toBeNull();
  });

  it('payments Paystack cannot confirm are named, and left out (not offered again)', async () => {
    api.backfill.mockResolvedValueOnce({ ok: true, applied: false, charges: 13, missing: 13, settled: 0 })
      .mockResolvedValueOnce({ ok: true, applied: true, charges: 13, missing: 13, written: 0, skipped: 0, failed: 0, notVerifiable: 13, notSuccessful: 0, remaining: 0 })
      .mockResolvedValueOnce({ ok: true, applied: false, charges: 13, missing: 0, settled: 13 });
    render(<PaymentHistory />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fill in 13' })); });
    expect(screen.getByTestId('backfill-check').textContent)
      .toBe('Filled in 0. 13 could not be checked with Paystack (made in test mode, or unknown) and are left out. All done.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check' })); });
    expect(screen.getByTestId('backfill-check').textContent).toBe('13 in-app payments found; 0 not in the list yet (13 already checked and left out).');
    expect(screen.queryByRole('button', { name: /Fill in/ })).toBeNull();
  });
});
