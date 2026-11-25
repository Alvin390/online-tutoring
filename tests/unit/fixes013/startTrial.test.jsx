import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import StartTrialModal from '@/features/admin/components/StartTrialModal';

/**
 * 013Fixes / 19 — superadmin "Start trial": the package (the school's
 * current one), the length (the billing setting), an optional payment
 * (M-Pesa needs its code), then the confirmation in plain words:
 * "Start a 14-day Gold trial ending <date, time>?"
 */

// Mocked up front (hoisted) and the form imported statically, so loading it
// is not counted against a test's time limit on a busy machine.
const api = vi.hoisted(() => ({ start: null }));
vi.mock('@services/api/adminBilling', () => ({
  getBillingSettings: async () => ({ settings: { trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6 } }),
  startSchoolTrial: (...a) => api.start(...a),
}));

let start;
beforeEach(() => {
  start = vi.fn().mockResolvedValue({ ok: true, tier: 'gold', days: 14, trialEndsAt: new Date().toISOString() });
  api.start = start;
});
afterEach(() => { cleanup(); });

async function renderModal(props = {}) {
  const handlers = { onClose: vi.fn(), onStarted: vi.fn() };
  render(<StartTrialModal currentTier="gold" {...handlers} {...props} />);
  await screen.findByDisplayValue('14');
  return handlers;
}
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

describe('Start trial', () => {
  it('the school\'s package and the setting\'s length; then the question in plain words; then started', async () => {
    const { onStarted } = await renderModal();
    expect(screen.getByLabelText('Package').value).toBe('gold');
    await click('Continue');
    expect(screen.getByTestId('start-trial-question').textContent).toMatch(/^Start a 14-day Gold trial ending .+\?$/);
    await click('Start trial');
    expect(start).toHaveBeenCalledWith({ tier: 'gold', days: 14, payment: undefined });
    expect(onStarted).toHaveBeenCalled();
  });

  it('with an M-Pesa payment: the code is needed, sent in capitals with the amount and note', async () => {
    await renderModal();
    fireEvent.click(screen.getByLabelText('Record a payment with this trial'));
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '2500' } });
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true); // no code yet
    fireEvent.change(screen.getByLabelText('M-Pesa code'), { target: { value: 'qab1c2d3e4' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Half of December' } });
    await click('Continue');
    expect(screen.getByTestId('start-trial-question').textContent).toMatch(/KES 2,500 by M-Pesa/);
    await click('Start trial');
    expect(start).toHaveBeenCalledWith({ tier: 'gold', days: 14, payment: { amountKes: 2500, method: 'mpesa', code: 'QAB1C2D3E4', note: 'Half of December' } });
  });

  it('cash: no code box; a 7-day Silver trial', async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'silver' } });
    fireEvent.change(screen.getByLabelText('Trial length (days)'), { target: { value: '7' } });
    fireEvent.click(screen.getByLabelText('Record a payment with this trial'));
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'cash' } });
    expect(screen.queryByLabelText('M-Pesa code')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '1000' } });
    await click('Continue');
    expect(screen.getByTestId('start-trial-question').textContent).toMatch(/^Start a 7-day Silver trial ending/);
    await click('Start trial');
    expect(start).toHaveBeenCalledWith({ tier: 'silver', days: 7, payment: { amountKes: 1000, method: 'cash' } });
  });

  it('a refusal (a paid period running) is shown in the server\'s words, back on the form', async () => {
    start.mockRejectedValueOnce(Object.assign(new Error('A paid period is running. Use Change plan instead.'), { code: 'active_period' }));
    await renderModal();
    await click('Continue');
    await click('Start trial');
    expect(screen.getByRole('alert').textContent).toBe('A paid period is running. Use Change plan instead.');
    expect(within(screen.getByRole('dialog')).getByLabelText('Package')).toBeTruthy();
  });
});
