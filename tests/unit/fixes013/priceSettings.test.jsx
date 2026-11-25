import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import PriceSettings, { orderWarning } from '@/features/admin/components/PriceSettings';

/**
 * 013Fixes / 26 — the superadmin's price form: each package's price (its
 * shared Paystack plan), the mode, Edit → the confirmation in plain words
 * ("every school", "from its next payment"), the name typed back in live
 * mode, the order warning, Paystack's refusal shown, "Refresh prices now".
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminPrices', () => ({
  getPrices: (...a) => api.getPrices(...a),
  refreshPrices: (...a) => api.refreshPrices(...a),
  changePrice: (...a) => api.changePrice(...a),
}));

const base = { mode: 'dev', prices: { bronze: 4999, silver: 7499, gold: 9999 }, previous: null, source: 'paystack' };
beforeEach(() => {
  api.getPrices = vi.fn().mockResolvedValue(base);
  api.refreshPrices = vi.fn().mockResolvedValue({ ...base, prices: { ...base.prices, gold: 11000 } });
  api.changePrice = vi.fn(async ({ tier, amountKes }) => ({ ok: true, ...base, prices: { ...base.prices, [tier]: amountKes } }));
});
afterEach(() => { cleanup(); });

const flush = () => act(async () => {});
const click = async (name, scope = screen) => { await act(async () => { fireEvent.click(scope.getByRole('button', { name })); }); };

async function editSilver(value) {
  render(<PriceSettings />);
  await flush();
  await click('Edit', within(screen.getByTestId('price-silver')));
  fireEvent.change(screen.getByLabelText('Silver price (KES a month)'), { target: { value } });
  await click('Continue');
}

describe('the price form', () => {
  it('each price and the mode', async () => {
    render(<PriceSettings />);
    await flush();
    expect(screen.getByTestId('price-mode').textContent).toBe('Test mode');
    expect(screen.getByTestId('price-silver').textContent).toMatch(/Silver\s*KES 7,499 a month/);
  });

  it('the confirmation says every school and the next payment; then changed', async () => {
    await editSilver('8000');
    const text = screen.getByTestId('price-confirm').textContent;
    expect(text).toMatch(/Change Silver from KES 7,499 to KES 8,000 a month\?/);
    expect(text).toMatch(/every school/);
    expect(text).toMatch(/from its next payment/);
    await click('Change the price');
    expect(api.changePrice).toHaveBeenCalledWith({ tier: 'silver', amountKes: 8000 });
    expect(screen.getByRole('status').textContent).toMatch(/Silver is now KES 8,000 a month for every school/);
    expect(screen.getByTestId('price-silver').textContent).toMatch(/KES 8,000/);
  });

  it('out of order is a warning, not a refusal', async () => {
    await editSilver('12000');
    expect(screen.getByTestId('price-order-warning').textContent).toBe('Silver would cost more than Gold.');
    expect(screen.getByRole('button', { name: 'Change the price' }).disabled).toBe(false);
  });

  it('not a whole number: no Continue', async () => {
    render(<PriceSettings />);
    await flush();
    await click('Edit', within(screen.getByTestId('price-silver')));
    fireEvent.change(screen.getByLabelText('Silver price (KES a month)'), { target: { value: '80.5' } });
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
  });

  it('live: the plan\'s name typed back before the button works', async () => {
    api.getPrices.mockResolvedValueOnce({ ...base, mode: 'live' });
    await editSilver('8000');
    expect(screen.getByTestId('price-mode').textContent).toBe('Live');
    expect(screen.getByRole('button', { name: 'Change the price' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type Silver to confirm/), { target: { value: 'silver' } });
    await click('Change the price');
    expect(api.changePrice).toHaveBeenCalledWith({ tier: 'silver', amountKes: 8000, confirmName: 'silver' });
  });

  it('Paystack refuses: its words, in the dialog', async () => {
    api.changePrice.mockRejectedValueOnce(new Error('Plan not found'));
    await editSilver('8000');
    await click('Change the price');
    expect(screen.getByRole('alert').textContent).toBe('Plan not found');
  });

  it('"Refresh prices now" asks Paystack again', async () => {
    render(<PriceSettings />);
    await flush();
    await click('Refresh prices now');
    expect(api.refreshPrices).toHaveBeenCalled();
    expect(screen.getByTestId('price-gold').textContent).toMatch(/KES 11,000/);
  });

  it('Paystack unreachable: the screen says which prices it shows', async () => {
    api.getPrices.mockResolvedValueOnce({ ...base, source: 'stored' });
    render(<PriceSettings />);
    await flush();
    expect(screen.getByText(/the last prices it gave/)).toBeTruthy();
  });

  it('the order check', () => {
    expect(orderWarning({ bronze: 1, silver: 2, gold: 3 })).toBeNull();
    expect(orderWarning({ bronze: 2, silver: 2, gold: 3 })).toBe('Bronze would cost the same as Silver.');
  });
});
