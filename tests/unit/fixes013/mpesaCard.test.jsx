import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import MpesaCard from '@/features/admin/components/MpesaCard';

/**
 * 013Fixes / 30 — the superadmin's M-Pesa (STK) card: the switch, the keys
 * (only the last 4 characters shown; the form up front in live mode when none
 * are set), the KES 1 test and its result, Gold and the flag as notes.
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminDaraja', () => ({
  getMpesaSetup: (...a) => api.getMpesaSetup(...a),
  saveMpesaKeys: (...a) => api.saveMpesaKeys(...a),
  clearMpesaKeys: (...a) => api.clearMpesaKeys(...a),
  setMpesaEnabled: (...a) => api.setMpesaEnabled(...a),
  sendMpesaTest: (...a) => api.sendMpesaTest(...a),
  checkMpesaTest: (...a) => api.checkMpesaTest(...a),
}));

const base = (over = {}) => ({
  mode: 'dev', source: 'env', ready: { flag: true, gold: true },
  keys: { saved: false, shortCodeType: null, last4: null, savedAt: null },
  mpesa: { enabled: false, online: false, testPending: false, testedAt: null, testPhoneMasked: null, lastError: null },
  ...over,
});
const withMpesa = (m, over = {}) => base({ ...over, mpesa: { ...base().mpesa, ...m } });

beforeEach(() => {
  api.getMpesaSetup = vi.fn().mockResolvedValue(base());
  api.setMpesaEnabled = vi.fn(async (enabled) => withMpesa({ enabled }));
  api.saveMpesaKeys = vi.fn();
  api.clearMpesaKeys = vi.fn();
  api.sendMpesaTest = vi.fn(async () => withMpesa({ enabled: true, testPending: true }));
  api.checkMpesaTest = vi.fn(async () => withMpesa({ enabled: true, online: true, testedAt: Date.parse('2026-11-26T07:00:00Z'), testPhoneMasked: '+2547••••0123' }));
});
afterEach(() => cleanup());

const flush = () => act(async () => {});
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };

describe('the M-Pesa card', () => {
  it('off: says so, and the switch turns it on (not yet online)', async () => {
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-badge').textContent).toBe('Off');
    expect(screen.queryByRole('button', { name: /Send test payment/ })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    // Sandbox mode (the default here): the second, explicit step (013Fixes / 32).
    await click('Switch on in sandbox');
    expect(api.setMpesaEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('mpesa-badge').textContent).toBe('Not tested');
  });

  it('the test: KES 1 to the phone typed, then the result → Online, with when and the masked phone', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ enabled: true }));
    render(<MpesaCard />);
    await flush();
    fireEvent.change(screen.getByLabelText('Phone for the test'), { target: { value: '0700000123' } });
    await click('Send test payment (KES 1)');
    expect(api.sendMpesaTest).toHaveBeenCalledWith('0700000123');
    expect(screen.getByTestId('mpesa-badge').textContent).toBe('Testing…');
    await click('Check result');
    expect(screen.getByTestId('mpesa-badge').textContent).toBe('Online');
    expect(screen.getByTestId('mpesa-ready').textContent).toMatch(/Confirmed by M-Pesa on .*\(\+2547••••0123\)/);
  });

  it('a failed test shows M-Pesa\'s reason', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ enabled: true, lastError: 'You cancelled the payment request.' }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-last-error').textContent).toBe('Last test: You cancelled the payment request.');
  });

  it('live, on, no keys: the form is up front; saving sends every field; only the last 4 come back', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ enabled: true }, { mode: 'live', source: null }));
    api.saveMpesaKeys.mockResolvedValueOnce(withMpesa({ enabled: true }, {
      mode: 'live', source: 'stored',
      keys: { saved: true, shortCodeType: 'till', last4: { consumerKey: '1111', consumerSecret: '2222', passkey: '3333', shortCode: '0999' }, savedAt: Date.now() },
    }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-form')).toBeTruthy();
    expect(screen.getByLabelText('Consumer secret').type).toBe('password');
    for (const [label, value] of [['Consumer key', 'CK-placeholder-1111'], ['Consumer secret', 'CS-placeholder-2222'], ['Passkey', 'PK-placeholder-3333'], ['Till or paybill number', '600999']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await click('Save keys');
    expect(api.saveMpesaKeys).toHaveBeenCalledWith({ consumerKey: 'CK-placeholder-1111', consumerSecret: 'CS-placeholder-2222', passkey: 'PK-placeholder-3333', shortCode: '600999', shortCodeType: 'till' });
    expect(screen.getByTestId('mpesa-keys').textContent).toMatch(/Till ••••0999, consumer key ••••1111, secret ••••2222, passkey ••••3333/);
    expect(screen.queryByTestId('mpesa-form')).toBeNull();
    expect(document.body.textContent).not.toMatch(/placeholder-/);
  });

  it('a till/paybill number that isn\'t digits: Save stays off', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(base());
    render(<MpesaCard />);
    await flush();
    await click('Enter keys');
    for (const [label, value] of [['Consumer key', 'a'], ['Consumer secret', 'b'], ['Passkey', 'c'], ['Till or paybill number', '60A999']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    expect(screen.getByRole('button', { name: 'Save keys' }).disabled).toBe(true);
  });

  it('Gold only and the flag, as notes', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(base({ ready: { flag: false, gold: false } }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-ready').textContent).toMatch(/Gold only/);
    expect(screen.getByTestId('mpesa-ready').textContent).toMatch(/payments\.daraja feature flag is off/);
  });
});

// 013Fixes / 32 (release review): in sandbox mode, payments are not real money.
describe('sandbox mode', () => {
  it('says so in red, and switching on needs a second, explicit step', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(base({ mode: 'dev' }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-sandbox-warning').textContent).toMatch(/not real money/);
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    expect(api.setMpesaEnabled).not.toHaveBeenCalled();
    expect(screen.getByTestId('mpesa-sandbox-confirm').textContent).toMatch(/students .*unblocked/i);
    await click('Switch on in sandbox');
    expect(api.setMpesaEnabled).toHaveBeenCalledWith(true);
  });

  it('live mode: no warning, the switch acts at once', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(base({ mode: 'live', source: 'stored' }));
    render(<MpesaCard />);
    await flush();
    expect(screen.queryByTestId('mpesa-sandbox-warning')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('switch')); });
    expect(api.setMpesaEnabled).toHaveBeenCalledWith(true);
  });
});
