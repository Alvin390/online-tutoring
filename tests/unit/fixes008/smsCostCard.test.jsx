import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';

/**
 * 008Fixes / 10 — Superadmin → SMS (owner answers 6 and 8): the balance in
 * KES and SMS, used % since the last top-up, the alerts sent, usage per
 * teacher, the setup, where alerts go, Refresh balance. No cap settings.
 */

const api = vi.hoisted(() => ({ getSmsSummary: vi.fn(), refreshSmsBalance: vi.fn(), setSmsAlertRecipient: vi.fn(), resetSmsAlertRecipient: vi.fn() }));
vi.mock('@services/api/adminSms', () => api);

const summary = (over = {}) => ({
  balance: { balance: 80, units: 228, fullAt: 400, usedFraction: 0.8, at: '2026-11-20T08:00:00Z', topUpAt: '2026-11-01T08:00:00Z', alerted80At: '2026-11-20T08:00:00Z', alertedEmptyAt: null },
  month: '2026-11',
  usage: [
    { uid: 'a', email: 'mwalimu@school.example', units: 600, cost: 210, monthUnits: 400, monthCost: 140, lastAt: '2026-11-20T07:00:00Z' },
    { uid: 'b', email: 'other@school.example', units: 300, cost: 105, monthUnits: 100, monthCost: 35, lastAt: '2026-11-10T07:00:00Z' },
  ],
  totals: { monthUnits: 500, monthCost: 175, units: 900, cost: 315 },
  setup: { unlocked: true, unlockedAt: '2026-11-15T10:00:00Z', unlockedByEmail: 'mwalimu@school.example', schoolName: 'Focus' },
  alerts: { recipient: 'reports@school.example', source: 'report', usedThreshold: 0.8 },
  rate: 0.35,
  reserve: 100,
  ...over,
});

async function renderCard() {
  const { default: SmsCostCard } = await import('@features/sms/components/SmsCostCard');
  render(<SmsCostCard />);
  return screen.findByTestId('sms-cost-card');
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getSmsSummary.mockResolvedValue(summary());
});
afterEach(() => cleanup());

describe('the card', () => {
  it('balance in KES and SMS, used %, top-up, reserve, alerts sent', async () => {
    await renderCard();
    const wallet = screen.getByTestId('sms-wallet');
    expect(wallet.textContent).toMatch(/KES 80\.00/);
    expect(wallet.textContent).toMatch(/about 228 SMS at KES 0\.35 each/);
    expect(wallet.textContent).toMatch(/80% used of KES 400\.00 since the last top-up/);
    expect(wallet.textContent).toMatch(/Bulk SMS stops at KES 100\.00/);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
    const alerts = screen.getByTestId('sms-alerts').textContent;
    expect(alerts).toMatch(/80% used alert: sent/);
    expect(alerts).toMatch(/No credit alert: not sent since the last top-up/);
    expect(screen.getByText(/Set up as/).textContent).toMatch(/Focus.*by mwalimu@school\.example/);
    expect(screen.queryByText(/cap|limit per teacher/i)).toBeNull();
  });

  it('per teacher: this month and total, with a total row', async () => {
    await renderCard();
    const rows = within(screen.getByTestId('sms-usage')).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/mwalimu@school\.example.*400 SMS · KES 140\.00.*600 SMS · KES 210\.00/);
    expect(rows[3].textContent).toMatch(/All.*500 SMS · KES 175\.00.*900 SMS · KES 315\.00/);
  });

  it('nothing yet: says how the balance appears; not set up says where', async () => {
    api.getSmsSummary.mockResolvedValue(summary({ balance: null, usage: [], setup: { unlocked: false } }));
    await renderCard();
    expect(screen.getByText(/No balance seen yet/)).toBeTruthy();
    expect(screen.getByText(/No SMS sent yet/)).toBeTruthy();
    expect(screen.getByText(/Not set up yet: a teacher does it on the Messages tab/)).toBeTruthy();
  });

  it('Refresh balance asks once and shows the new figures', async () => {
    api.refreshSmsBalance.mockResolvedValue(summary({ balance: { ...summary().balance, balance: 1000, units: 2857, fullAt: 1000, usedFraction: 0, alerted80At: null } }));
    await renderCard();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Refresh balance/ })); });
    expect(api.refreshSmsBalance).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sms-wallet').textContent).toMatch(/KES 1,000\.00/);
    expect(screen.getByRole('status').textContent).toMatch(/Balance checked with HashBack/);
  });

  it('alert recipient: a bad address is refused here; a good one saved; back to the report recipient', async () => {
    await renderCard();
    expect(screen.getByText(/Now:/).textContent).toMatch(/reports@school\.example \(the report recipient, until you set one here\)/);
    const field = screen.getByLabelText('Email for SMS credit alerts');
    await act(async () => { fireEvent.change(field, { target: { value: 'nope' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(api.setSmsAlertRecipient).not.toHaveBeenCalled();

    api.setSmsAlertRecipient.mockResolvedValue(summary({ alerts: { recipient: 'owner@school.example', source: 'sms', usedThreshold: 0.8 } }));
    await act(async () => { fireEvent.change(field, { target: { value: 'Owner@School.example' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(api.setSmsAlertRecipient).toHaveBeenCalledWith('Owner@School.example');
    expect(screen.getByText(/Now:/).textContent).toMatch(/owner@school\.example\.$/);

    api.resetSmsAlertRecipient.mockResolvedValue(summary());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use the report recipient' })); });
    expect(api.resetSmsAlertRecipient).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Use the report recipient' })).toBeNull();
  });
});
