import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import RecordPaymentModal from '@/features/admin/components/RecordPaymentModal';

/**
 * 013Fixes / 20 — superadmin "Record payment": package, amount, method,
 * M-Pesa code (needed for M-Pesa), note. Continue asks the server for the
 * window (a preview writes nothing), the confirmation says it in plain
 * words, then the payment is recorded.
 */

const from = Date.parse('2026-12-10T06:00:00Z');
const to = Date.parse('2027-01-10T06:00:00Z');
// Mocked up front (hoisted) and the form imported statically, so loading it
// is not counted against a test's time limit on a busy machine.
const api = vi.hoisted(() => ({ rec: null }));
vi.mock('@services/api/adminBilling', () => ({ recordSchoolPayment: (...a) => api.rec(...a) }));

let rec;
beforeEach(() => {
  rec = vi.fn(async (body) => (body.preview
    ? { ok: true, preview: true, tier: body.tier, window: { from, to, startsNow: true } }
    : { ok: true, tier: body.tier, window: { from, to, startsNow: true } }));
  api.rec = rec;
});
afterEach(() => { cleanup(); });

async function renderModal() {
  const handlers = { onClose: vi.fn(), onRecorded: vi.fn() };
  render(<RecordPaymentModal currentTier="silver" {...handlers} />);
  return handlers;
}
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

describe('Record payment', () => {
  it('M-Pesa: the code is needed; a preview first; then recorded in capitals', async () => {
    const { onRecorded } = await renderModal();
    expect(screen.getByLabelText('Package').value).toBe('silver');
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'gold' } });
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '5000' } });
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('M-Pesa code'), { target: { value: 'qxy1z2w3v4' } });
    await click('Continue');
    expect(rec).toHaveBeenLastCalledWith({ tier: 'gold', amountKes: 5000, method: 'mpesa', code: 'QXY1Z2W3V4', preview: true });
    const q = screen.getByTestId('record-payment-question').textContent;
    expect(q).toMatch(/^Record KES 5,000 by M-Pesa for Gold, covering 10 December 2026.* to 10 January 2027.*\?/);
    expect(q).toMatch(/starts now/);
    await click('Record payment');
    expect(rec).toHaveBeenLastCalledWith({ tier: 'gold', amountKes: 5000, method: 'mpesa', code: 'QXY1Z2W3V4' });
    expect(onRecorded).toHaveBeenCalled();
  });

  it('an early payment says it starts when the current period ends', async () => {
    rec.mockResolvedValueOnce({ ok: true, preview: true, tier: 'silver', window: { from, to, startsNow: false } });
    await renderModal();
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'cash' } });
    expect(screen.queryByLabelText('M-Pesa code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Paid at the office' } });
    await click('Continue');
    expect(rec).toHaveBeenLastCalledWith({ tier: 'silver', amountKes: 3000, method: 'cash', note: 'Paid at the office', preview: true });
    expect(screen.getByTestId('record-payment-question').textContent).toMatch(/starts when the current period ends/);
  });

  it('a refusal (the code already recorded) is shown in the server\'s words, back on the form', async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('M-Pesa code'), { target: { value: 'QXY1Z2W3V4' } });
    await click('Continue');
    rec.mockRejectedValueOnce(Object.assign(new Error('That M-Pesa code is already recorded.'), { code: 'payment_code_used' }));
    await click('Record payment');
    expect(screen.getByRole('alert').textContent).toBe('That M-Pesa code is already recorded.');
    expect(screen.getByLabelText('Amount (KES)')).toBeTruthy();
  });

  it('a card school is refused at the preview, in the server\'s words', async () => {
    rec.mockRejectedValueOnce(new Error('This school pays by card automatically. Cancel the card subscription first, or it will be charged twice.'));
    await renderModal();
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '3000' } });
    await click('Continue');
    expect(screen.getByRole('alert').textContent).toMatch(/pays by card automatically/);
    expect(screen.queryByTestId('record-payment-question')).toBeNull();
  });
});
