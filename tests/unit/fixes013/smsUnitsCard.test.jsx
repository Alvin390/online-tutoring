import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * 013Fixes / 16 — Superadmin → SMS units: the balance, the ledger and
 * "Add SMS units" (a note, and a fresh key per add so a double click adds once).
 */

const api = vi.hoisted(() => ({ getSmsCredits: vi.fn(), addSmsUnits: vi.fn() }));
vi.mock('@services/api/adminSms', () => api);

const { default: SmsUnitsCard } = await import('@features/sms/components/SmsUnitsCard');

const CREDITS = { windowId: 'month-2026-11', granted: 3000, includedUsed: 1000, includedLeft: 2000, topup: 340, available: 2340 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getSmsCredits.mockResolvedValue({ credits: CREDITS, ledger: [
    { id: 'grant:month-2026-11', type: 'grant', units: 3000, at: '2026-11-01T00:00:00Z' },
    { id: 'topup:abc', type: 'topup_added', units: 340, note: 'MPESA QWE123', at: '2026-11-05T09:00:00Z' },
  ] });
});

describe('the SMS units card', () => {
  it('shows included, used, extra and what is left, and the ledger', async () => {
    render(<SmsUnitsCard />);
    expect((await screen.findByTestId('sms-units-available')).textContent).toBe('2,340');
    expect(screen.getByText('MPESA QWE123')).toBeTruthy();
    expect(screen.getByText('Added by hand')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/KES/);
  });

  it('adds units with the note and a key; the next add uses a new key', async () => {
    api.addSmsUnits.mockResolvedValue({ added: 500, already: false, credits: { ...CREDITS, topup: 840, available: 2840 }, ledger: [] });
    render(<SmsUnitsCard />);
    await screen.findByTestId('sms-units-card');
    fireEvent.change(screen.getByLabelText('Add units'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'MPESA ZXC987' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add SMS units' })); });
    const first = api.addSmsUnits.mock.calls[0][0];
    expect(first).toMatchObject({ units: 500, note: 'MPESA ZXC987' });
    expect(first.key).toMatch(/^[A-Za-z0-9]{8,32}$/);
    expect(screen.getByTestId('sms-units-available').textContent).toBe('2,840');
    fireEvent.change(screen.getByLabelText('Add units'), { target: { value: '10' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add SMS units' })); });
    expect(api.addSmsUnits.mock.calls[1][0].key).not.toBe(first.key);
  });

  it('refuses a bad number before sending', async () => {
    render(<SmsUnitsCard />);
    await screen.findByTestId('sms-units-card');
    fireEvent.change(screen.getByLabelText('Add units'), { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add SMS units' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/whole number/));
    expect(api.addSmsUnits).not.toHaveBeenCalled();
  });
});
