import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 013Fixes / 18 — the screens: "Your plan expires on …" (Nairobi time) on
 * the billing page; the countdown banner inside the window (a trial's last
 * 48 hours, a failed card) and not before; the superadmin billing settings.
 */

const H = 3_600_000;

beforeEach(() => { vi.resetModules(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.doUnmock('@/features/billing/context/BillingContext'); vi.doUnmock('@services/api/adminBilling'); });

describe('"Your plan expires on …"', () => {
  it('a trial or M-Pesa period: when access stops, in Nairobi time', async () => {
    const { planEnd } = await import('@/features/billing/planEnd');
    const end = Date.parse('2026-12-03T14:00:00Z'); // 5:00 pm in Nairobi
    const line = planEnd({ status: 'trialing', endsAt: end, renews: false });
    expect(line.label).toBe('Your plan expires on');
    expect(line.text).toMatch(/3 December 2026.*5:00\s?pm/i);
  });

  it('a card that renews: "Renews on"; cancelled: "Access ends on"; a gift plan: nothing', async () => {
    const { planEnd } = await import('@/features/billing/planEnd');
    const periodEnd = Date.parse('2026-12-31T21:00:00Z');
    expect(planEnd({ status: 'active', renews: true, currentPeriodEnd: periodEnd, endsAt: periodEnd + 6 * H }).label).toBe('Renews on');
    expect(planEnd({ status: 'cancelled', cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd }).label).toBe('Access ends on');
    expect(planEnd({ status: 'active', comp: true, currentPeriodEnd: periodEnd })).toBeNull();
    expect(planEnd(null)).toBeNull();
  });
});

async function renderBanner(billing) {
  vi.doMock('@/features/billing/context/BillingContext', () => ({ useBilling: () => ({ billingEnabled: true, inGrace: false, graceEndsAt: null, ...billing }) }));
  const { default: Banner } = await import('@/features/billing/components/GracePeriodCountdown');
  return render(<MemoryRouter><Banner /></MemoryRouter>);
}

describe('the countdown banner', () => {
  it('inside the window (a trial\'s last 48 hours): "Your free trial is ending"', async () => {
    const endsAt = Date.now() + 30 * H;
    await renderBanner({ status: 'trialing', endsAt, countdownFrom: endsAt - 48 * H });
    expect(screen.getByRole('status').textContent).toMatch(/Your free trial is ending/);
  });

  it('before the window: nothing; it appears by itself when the window opens', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const now = Date.now();
    const endsAt = now + 50 * H;
    await renderBanner({ status: 'active', endsAt, countdownFrom: endsAt - 48 * H });
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(2 * H + 100); });
    expect(screen.getByRole('status').textContent).toMatch(/Your subscription needs renewing/);
  });

  it('a card that renews (no countdownFrom): nothing', async () => {
    await renderBanner({ status: 'active', endsAt: Date.now() + 10 * H, countdownFrom: null, renews: true });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a school already in grace: still counts down (legacy)', async () => {
    await renderBanner({ status: 'grace', inGrace: true, graceEndsAt: Date.now() + 10 * H, endsAt: null, countdownFrom: null });
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('superadmin: billing settings', () => {
  it('shows the settings; Save only after a change; sends whole numbers', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, settings: { trialDays: 10, countdownHours: 48, cardRenewalToleranceHours: 6, reminderFirstDays: 3, reminderSecondDays: 1 } });
    vi.doMock('@services/api/adminBilling', () => ({
      getBillingSettings: vi.fn().mockResolvedValue({ settings: { trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6, reminderFirstDays: 3, reminderSecondDays: 1 } }),
      saveBillingSettings: save,
    }));
    const { default: BillingSettings } = await import('@/features/admin/components/BillingSettings');
    render(<BillingSettings />);
    const trial = await screen.findByLabelText('Trial length (days)');
    expect(trial.value).toBe('14');
    const button = screen.getByRole('button', { name: 'Save billing settings' });
    expect(button.disabled).toBe(true);
    fireEvent.change(trial, { target: { value: '10' } });
    await act(async () => { fireEvent.click(button); });
    expect(save).toHaveBeenCalledWith({ trialDays: 10, countdownHours: 48, cardRenewalToleranceHours: 6, reminderFirstDays: 3, reminderSecondDays: 1 });
    expect(screen.getByRole('status').textContent).toMatch(/Saved/);
  });

  it('a refusal is shown in the server\'s words', async () => {
    vi.doMock('@services/api/adminBilling', () => ({
      getBillingSettings: vi.fn().mockResolvedValue({ settings: { trialDays: 14, countdownHours: 48, cardRenewalToleranceHours: 6, reminderFirstDays: 3, reminderSecondDays: 1 } }),
      saveBillingSettings: vi.fn().mockRejectedValue(Object.assign(new Error('The countdown must start before the trial does: make it shorter than the trial.'), { code: 'bad_settings' })),
    }));
    const { default: BillingSettings } = await import('@/features/admin/components/BillingSettings');
    render(<BillingSettings />);
    fireEvent.change(await screen.findByLabelText('Countdown (hours before the end)'), { target: { value: '400' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save billing settings' })); });
    expect(screen.getByRole('alert').textContent).toMatch(/countdown must start before the trial/);
  });
});
