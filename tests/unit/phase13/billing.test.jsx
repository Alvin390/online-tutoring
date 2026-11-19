import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Phase 13 / 05 D3 — the billing page's undo for a scheduled downgrade. It used
 * to say "undo by choosing your current plan again" while that button was
 * disabled.
 */

beforeEach(() => vi.resetModules());

async function renderBilling({ scheduled, plan = null }) {
  const cancelDowngrade = vi.fn().mockResolvedValue({ ok: true, manualRenewalNeeded: false });
  const showSuccess = vi.fn();
  vi.doMock('@features/billing/context/BillingContext', () => ({
    useBilling: () => ({
      subscription: {
        tier: 'gold', status: 'active', renewalMode: 'auto',
        currentPeriodEnd: '2026-11-14T00:00:00.000Z',
        scheduledTierChange: scheduled,
      },
      status: 'active', tier: 'gold', isLocked: false, loading: false, refresh: vi.fn(), plan,
    }),
  }));
  vi.doMock('@services/api/billing', () => ({
    initializeCheckout: vi.fn(), cancelSubscription: vi.fn(), resumeSubscription: vi.fn(),
    scheduleDowngrade: vi.fn(), cancelDowngrade,
  }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess, showError: vi.fn() }), useOptionalToast: () => null }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
  vi.doMock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
  const { default: BillingPage } = await import('@/pages/BillingPage.jsx');
  render(<MemoryRouter><BillingPage /></MemoryRouter>);
  return { cancelDowngrade, showSuccess };
}

describe('scheduled downgrade banner', () => {
  it('shows the date and new price, and "Keep Gold instead" undoes it', async () => {
    const { cancelDowngrade, showSuccess } = await renderBilling({
      scheduled: { tier: 'bronze', effectiveAt: '2026-11-14T00:00:00.000Z' },
    });
    const banner = screen.getByTestId('scheduled-change');
    expect(banner.textContent).toMatch(/Downgrade to Bronze scheduled for/);
    expect(banner.textContent).toMatch(/4,999/);

    const keep = screen.getByRole('button', { name: /Keep Gold instead/ });
    expect(keep.disabled).toBe(false);
    fireEvent.click(keep);
    await waitFor(() => expect(cancelDowngrade).toHaveBeenCalled());
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/stay on Gold/)));
  });

  it('no banner when nothing is scheduled', async () => {
    await renderBilling({ scheduled: null });
    expect(screen.queryByTestId('scheduled-change')).toBeNull();
  });
});

// 013Fixes / 07: the cards use the superadmin's plan settings from the status call.
describe('plan cards', () => {
  it('show each plan words and limits as the superadmin set them', async () => {
    const { DEFAULT_PLANS } = await import('@shared/constants/plans');
    const catalog = Object.fromEntries(['bronze', 'silver', 'gold'].map((id) => [id, { limits: DEFAULT_PLANS[id].limits, card: DEFAULT_PLANS[id].card }]));
    catalog.silver = { limits: { ...DEFAULT_PLANS.silver.limits, logins: 6 }, card: { ...DEFAULT_PLANS.silver.card, tagline: 'Fees made simple' } };
    await renderBilling({ scheduled: null, plan: { tier: 'gold', catalog } });
    expect(screen.getByText('Fees made simple')).toBeTruthy();
    expect(screen.getByText('Up to 300 active students, 5 sessions and 6 dashboard logins')).toBeTruthy();
    expect(screen.getByText('Advanced management and automation')).toBeTruthy();
  });

  it('without the catalog, the shipped words (never WhatsApp campaigns)', async () => {
    await renderBilling({ scheduled: null });
    expect(screen.getByText('Complete tuition management')).toBeTruthy();
    expect(screen.queryByText(/WhatsApp broadcast|documents and photos/)).toBeNull();
  });
});

