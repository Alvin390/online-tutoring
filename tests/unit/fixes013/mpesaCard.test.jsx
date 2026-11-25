import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import MpesaCard from '@/features/admin/components/MpesaCard';

/**
 * 013Fixes / 30b — the superadmin's M-Pesa (STK) card: one setting with three
 * positions (Off / Demo / Live; owner, 2026-11-25), the live keys (only the
 * last 4 characters shown; the form up front on Live when none are set), the
 * KES 1 test (Live only) and its result, Gold and the flag as notes.
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminDaraja', () => ({
  getMpesaSetup: (...a) => api.getMpesaSetup(...a),
  saveMpesaKeys: (...a) => api.saveMpesaKeys(...a),
  clearMpesaKeys: (...a) => api.clearMpesaKeys(...a),
  setMpesaMode: (...a) => api.setMpesaMode(...a),
  sendMpesaTest: (...a) => api.sendMpesaTest(...a),
  checkMpesaTest: (...a) => api.checkMpesaTest(...a),
}));

const base = (over = {}) => ({
  sources: { sandbox: 'env', live: 'env' }, ready: { flag: true, gold: true },
  keys: { saved: false, shortCodeType: null, last4: null, savedAt: null },
  mpesa: { mode: 'off', liveTested: false, testPending: false, testedAt: null, testPhoneMasked: null, lastError: null },
  ...over,
});
const withMpesa = (m, over = {}) => base({ ...over, mpesa: { ...base().mpesa, ...m } });

beforeEach(() => {
  api.getMpesaSetup = vi.fn().mockResolvedValue(base());
  api.setMpesaMode = vi.fn(async (mode) => withMpesa({ mode }));
  api.saveMpesaKeys = vi.fn();
  api.clearMpesaKeys = vi.fn();
  api.sendMpesaTest = vi.fn(async () => withMpesa({ mode: 'live', testPending: true }));
  api.checkMpesaTest = vi.fn(async () => withMpesa({ mode: 'live', liveTested: true, testedAt: Date.parse('2026-11-26T07:00:00Z'), testPhoneMasked: '+2547••••0123' }));
});
afterEach(() => cleanup());

const flush = () => act(async () => {});
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const pick = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('radio', { name })); }); };
const badge = () => screen.getByTestId('mpesa-badge').textContent;

describe('the M-Pesa card', () => {
  it('Off → Demo → Live: one setting, the badge follows; Live starts untested', async () => {
    render(<MpesaCard />);
    await flush();
    expect(badge()).toBe('Off');
    expect(screen.getByRole('radio', { name: 'Off' }).getAttribute('aria-checked')).toBe('true');
    await pick('Demo');
    expect(api.setMpesaMode).toHaveBeenCalledWith('demo');
    expect(badge()).toBe('Demo');
    expect(screen.getByTestId('mpesa-mode-help').textContent).toMatch(/sandbox.*doesn.t pay fees/);
    // Demo has no KES 1 test: that is for the live keys.
    expect(screen.queryByRole('button', { name: /Send test payment/ })).toBeNull();
    await pick('Live');
    expect(api.setMpesaMode).toHaveBeenLastCalledWith('live');
    expect(badge()).toBe('Live — untested');
  });

  it('no sandbox-money warning any more (Demo never touches fees)', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ mode: 'demo' }));
    render(<MpesaCard />);
    await flush();
    expect(screen.queryByTestId('mpesa-sandbox-warning')).toBeNull();
    expect(screen.queryByTestId('mpesa-sandbox-confirm')).toBeNull();
  });

  it('the test (Live): KES 1 to the phone typed, then the result → Live — tested, with when and the masked phone', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ mode: 'live' }));
    render(<MpesaCard />);
    await flush();
    fireEvent.change(screen.getByLabelText('Phone for the test'), { target: { value: '0700000123' } });
    await click('Send test payment (KES 1)');
    expect(api.sendMpesaTest).toHaveBeenCalledWith('0700000123');
    expect(badge()).toBe('Live — testing…');
    await click('Check result');
    expect(badge()).toBe('Live — tested');
    expect(screen.getByTestId('mpesa-ready').textContent).toMatch(/confirmed by M-Pesa on .*\(\+2547••••0123\)/);
  });

  it('a failed test shows M-Pesa\'s reason', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ mode: 'live', lastError: 'You cancelled the payment request.' }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-last-error').textContent).toBe('Last test: You cancelled the payment request.');
  });

  it('Live, no live keys: the form is up front; saving sends every field; only the last 4 come back; untested', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ mode: 'live' }, { sources: { sandbox: 'env', live: null } }));
    api.saveMpesaKeys.mockResolvedValueOnce(withMpesa({ mode: 'live' }, {
      sources: { sandbox: 'env', live: 'stored' },
      keys: { saved: true, shortCodeType: 'till', last4: { consumerKey: '1111', consumerSecret: '2222', passkey: '3333', shortCode: '0999' }, savedAt: Date.now() },
    }));
    render(<MpesaCard />);
    await flush();
    expect(screen.getByTestId('mpesa-form')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send test payment/ })).toBeNull();
    expect(screen.getByLabelText('Consumer secret').type).toBe('password');
    for (const [label, value] of [['Consumer key', 'CK-placeholder-1111'], ['Consumer secret', 'CS-placeholder-2222'], ['Passkey', 'PK-placeholder-3333'], ['Till or paybill number', '600999']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await click('Save keys');
    expect(api.saveMpesaKeys).toHaveBeenCalledWith({ consumerKey: 'CK-placeholder-1111', consumerSecret: 'CS-placeholder-2222', passkey: 'PK-placeholder-3333', shortCode: '600999', shortCodeType: 'till' });
    expect(screen.getByTestId('mpesa-keys').textContent).toMatch(/Till ••••0999, consumer key ••••1111, secret ••••2222, passkey ••••3333/);
    expect(screen.queryByTestId('mpesa-form')).toBeNull();
    expect(badge()).toBe('Live — untested');
    expect(screen.getByRole('button', { name: 'Send test payment (KES 1)' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/placeholder-/);
  });

  it('a till/paybill number that isn\'t digits: Save stays off', async () => {
    render(<MpesaCard />);
    await flush();
    await click('Enter keys');
    for (const [label, value] of [['Consumer key', 'a'], ['Consumer secret', 'b'], ['Passkey', 'c'], ['Till or paybill number', '60A999']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    expect(screen.getByRole('button', { name: 'Save keys' }).disabled).toBe(true);
  });

  it('Gold only, the flag, and Demo without sandbox keys, as notes', async () => {
    api.getMpesaSetup.mockResolvedValueOnce(withMpesa({ mode: 'demo' }, { ready: { flag: false, gold: false }, sources: { sandbox: null, live: null } }));
    render(<MpesaCard />);
    await flush();
    const notes = screen.getByTestId('mpesa-ready').textContent;
    expect(notes).toMatch(/Gold only/);
    expect(notes).toMatch(/payments\.daraja feature flag is off/);
    expect(notes).toMatch(/No sandbox keys/);
  });
});
