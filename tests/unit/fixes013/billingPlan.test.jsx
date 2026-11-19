import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

/**
 * 013Fixes / 00 — BillingContext keeps the SCHOOL's plan from /api/billing/status,
 * and fetches it again when the projected tier changes (a webhook, a superadmin
 * plan change), so the screens follow without a reload. Only a CHANGE refetches.
 */

let snapshotCb = null;
const getBillingStatus = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  onSnapshot: (_ref, cb) => { snapshotCb = cb; return () => {}; },
}));
vi.mock('@services/firebase/config', () => ({ db: {} }));
vi.mock('@services/api/billing', () => ({ getBillingStatus: (...a) => getBillingStatus(...a) }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ isAuthenticated: true, isTeacher: true, tier: 'bronze', tierRank: 1, isSuperadmin: false }),
}));

const { BillingProvider } = await import('@features/billing/context/BillingContext');
const { usePlan } = await import('@features/billing/hooks/usePlan');

function Probe() {
  const plan = usePlan();
  return <div data-testid="probe">{`${plan.source}:${plan.tier}:${plan.has('targetedSms')}`}</div>;
}

const statusFor = (tier) => ({
  billingEnabled: true,
  subscription: { tier, status: 'active' },
  accessGranted: true,
  plan: { tier, comp: false, features: { targetedSms: tier === 'gold', fees: tier !== 'bronze' }, limits: {} },
});

const snap = (tier) => ({ exists: () => true, data: () => ({ tier, status: 'active' }) });

beforeEach(() => {
  snapshotCb = null;
  getBillingStatus.mockReset();
});

describe('the school plan in BillingContext', () => {
  it('uses the server\'s plan over the login\'s Bronze claim', async () => {
    getBillingStatus.mockResolvedValue(statusFor('gold'));
    render(<BillingProvider><Probe /></BillingProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('school:gold:true'));
  });

  it('refetches the plan when the projected tier changes, and only then', async () => {
    getBillingStatus.mockResolvedValueOnce(statusFor('silver')).mockResolvedValueOnce(statusFor('gold'));
    render(<BillingProvider><Probe /></BillingProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('school:silver:false'));

    act(() => snapshotCb(snap('silver'))); // first snapshot: remembered, no refetch
    act(() => snapshotCb(snap('silver'))); // same tier: no refetch
    expect(getBillingStatus).toHaveBeenCalledTimes(1);

    act(() => snapshotCb(snap('gold'))); // changed: refetch
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('school:gold:true'));
    expect(getBillingStatus).toHaveBeenCalledTimes(2);
  });

  it('a failed status check keeps the claim as a stand-in', async () => {
    getBillingStatus.mockRejectedValue(Object.assign(new Error('offline'), { code: 'network' }));
    render(<BillingProvider><Probe /></BillingProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('claims:bronze:false'));
  });
});
