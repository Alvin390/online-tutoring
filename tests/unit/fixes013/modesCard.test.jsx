import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import ModesCard from '@/features/admin/components/ModesCard';
import ModeBanners from '@/features/dashboard/nav/ModeBanners';
import { modesStore } from '@/shared/config/modesStore';

/**
 * 013Fixes / 33a — the superadmin's Modes card (Paystack live/test; TEST
 * typed during a paid period) and the teachers' banners.
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminModes', () => ({
  getModes: (...a) => api.getModes(...a),
  setPaymentsMode: (...a) => api.setPaymentsMode(...a),
}));

const view = (payments = {}, over = {}) => ({ payments: { mode: 'test', source: 'env', liveKeys: true, ...payments }, paidPeriod: false, ...over });
const confirmErr = () => Object.assign(new Error('The school is in a paid period. Type TEST to switch payments to test.'), { code: 'confirm_required' });

beforeEach(() => {
  api.getModes = vi.fn().mockResolvedValue(view());
  api.setPaymentsMode = vi.fn(async (mode) => view({ mode, source: 'setting' }));
  modesStore.__reset();
});
afterEach(() => cleanup());

const flush = () => act(async () => {});
const pick = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('radio', { name })); }); };

describe('the Modes card: payments', () => {
  it('shows the mode and where it comes from; Live switches', async () => {
    render(<ModesCard />);
    await flush();
    expect(screen.getByTestId('payments-badge').textContent).toBe('Test');
    expect(screen.getByTestId('payments-help').textContent).toMatch(/from the server settings/);
    expect(document.body.textContent).toMatch(/M-Pesa .*has its own setting/);
    await pick('Live');
    expect(api.setPaymentsMode).toHaveBeenCalledWith('live');
    expect(screen.getByTestId('payments-badge').textContent).toBe('Live');
    expect(screen.getByRole('status').textContent).toMatch(/within a minute or two/);
  });

  it('no live keys: Live can\'t be chosen', async () => {
    api.getModes.mockResolvedValueOnce(view({ liveKeys: false }));
    render(<ModesCard />);
    await flush();
    expect(screen.getByRole('radio', { name: 'Live' }).disabled).toBe(true);
    expect(screen.getByTestId('payments-help').textContent).toMatch(/No live Paystack keys/);
  });

  it('to test in a paid period: asks for TEST, then switches', async () => {
    api.getModes.mockResolvedValueOnce(view({ mode: 'live', source: 'setting' }, { paidPeriod: true }));
    api.setPaymentsMode = vi.fn(async (mode, confirm) => {
      if (confirm !== 'TEST') throw confirmErr();
      return view({ mode, source: 'setting' });
    });
    render(<ModesCard />);
    await flush();
    await pick('Test');
    expect(screen.getByTestId('payments-confirm')).toBeTruthy();
    const go = screen.getByRole('button', { name: 'Switch to test' });
    fireEvent.change(screen.getByLabelText('Type TEST'), { target: { value: 'test' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type TEST'), { target: { value: 'TEST' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to test' })); });
    expect(api.setPaymentsMode).toHaveBeenLastCalledWith('test', 'TEST');
    expect(screen.getByTestId('payments-badge').textContent).toBe('Test');
    expect(screen.queryByTestId('payments-confirm')).toBeNull();
  });
});

describe('the teachers\' banners', () => {
  it('nothing on a normal school (or before the bootstrap arrives)', () => {
    render(<ModeBanners />);
    expect(screen.queryByTestId('mode-banners')).toBeNull();
    act(() => modesStore.setFromRemote({ paymentsTest: false }));
    expect(screen.queryByTestId('mode-banners')).toBeNull();
  });

  it('test payments: says no real money', () => {
    render(<ModeBanners />);
    act(() => modesStore.setFromRemote({ paymentsTest: true }));
    expect(screen.getByTestId('mode-banner-payments').textContent).toMatch(/Test payments: no real money/);
  });
});
