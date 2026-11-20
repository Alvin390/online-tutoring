import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DEFAULT_PLANS, DEFAULT_CARDS, PLAN_IDS, limitLines, mergePlans } from '@shared/constants/plans';
import { TIERS } from '@shared/constants/tiers';
import * as server from '../../../api/_lib/plans.js';

/**
 * 013Fixes / 07 — the plan cards' words (owner's spec) as data, the limit lines
 * made from the limits, card overrides validated, and the superadmin editor.
 */

describe('the default cards', () => {
  const all = PLAN_IDS.map((id) => [DEFAULT_CARDS[id].tagline, DEFAULT_CARDS[id].description, ...DEFAULT_CARDS[id].bullets].join(' | '));

  it('never advertise WhatsApp campaigns, attachments or invoice PDFs', () => {
    for (const text of all) {
      expect(text).not.toMatch(/broadcast|campaign|documents and photos|attachment|invoice pdf|pdf invoice/i);
    }
  });

  it('put the calendar and one-to-one WhatsApp on Bronze, not as a Silver selling point', () => {
    expect(DEFAULT_CARDS.bronze.bullets.join(' ')).toMatch(/calendar/i);
    expect(DEFAULT_CARDS.bronze.bullets.join(' ')).toMatch(/WhatsApp to one parent/);
    expect(DEFAULT_CARDS.silver.bullets.join(' ')).not.toMatch(/calendar/i);
  });

  it('say STK needs Safaricom Go-Live setup', () => {
    expect(DEFAULT_CARDS.gold.bullets.join(' ')).toMatch(/after Safaricom Go-Live setup/);
  });

  it('are the same on both sides of the pair', () => {
    expect(DEFAULT_CARDS).toEqual(server.DEFAULT_CARDS);
    expect(limitLines(DEFAULT_PLANS.gold.limits)).toEqual(server.limitLines(server.DEFAULT_PLANS.gold.limits));
  });
});

describe('limit lines', () => {
  it('come from the limits, with SMS only when there are units', () => {
    expect(limitLines(DEFAULT_PLANS.bronze.limits)).toEqual(['Up to 100 active students, 2 sessions and 2 dashboard logins']);
    expect(limitLines(DEFAULT_PLANS.gold.limits)).toEqual([
      'Up to 500 active students, 10 sessions and 10 dashboard logins',
      '3,000 SMS units a month included',
    ]);
  });

  it('TIERS shows the card words plus the limit lines', () => {
    expect(TIERS.silver.tagline).toBe('Complete tuition management');
    expect(TIERS.silver.features).toContain('1,000 SMS units a month included');
    expect(TIERS.silver.priceKes).toBe(7499); // prices unchanged in this series
  });
});

describe('card overrides', () => {
  it('take well-formed words only', () => {
    const merged = mergePlans({
      silver: { card: { tagline: 'Fees made simple', bullets: ['One', 'Two'] } },
      gold: { card: { tagline: '', bullets: [], description: 'x'.repeat(201) } },
    });
    expect(merged.silver.card).toMatchObject({ tagline: 'Fees made simple', bullets: ['One', 'Two'] });
    expect(merged.gold.card).toEqual(DEFAULT_PLANS.gold.card);
  });
});

// ---------------------------------------------------------------- editor ---

const api = vi.hoisted(() => ({ getPlanSettings: vi.fn(), savePlanSettings: vi.fn(), resetPlanSettings: vi.fn() }));
vi.mock('@services/api/admin', () => api);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => toast }));

const { default: PlanSettings } = await import('@features/admin/components/PlanSettings');

beforeEach(() => {
  vi.clearAllMocks();
  api.getPlanSettings.mockResolvedValue({ defaults: DEFAULT_PLANS, overrides: {}, effective: mergePlans({}) });
  api.savePlanSettings.mockResolvedValue({ ok: true });
});

describe('the superadmin editor', () => {
  it('saves only what differs from the default', async () => {
    render(<PlanSettings />);
    const silver = await screen.findByTestId('plan-silver');
    fireEvent.change(within(silver).getByLabelText('Dashboard logins'), { target: { value: '6' } });
    fireEvent.click(within(silver).getByRole('button', { name: 'Save Silver' }));
    await waitFor(() => expect(api.savePlanSettings).toHaveBeenCalledWith({
      silver: { features: {}, limits: { logins: 6 }, card: {} },
    }));
  });

  it('refuses a bad number before sending', async () => {
    render(<PlanSettings />);
    const bronze = await screen.findByTestId('plan-bronze');
    fireEvent.change(within(bronze).getByLabelText('Sessions'), { target: { value: '-3' } });
    fireEvent.click(within(bronze).getByRole('button', { name: 'Save Bronze' }));
    expect(api.savePlanSettings).not.toHaveBeenCalled();
    expect(toast.showError).toHaveBeenCalledWith(expect.stringMatching(/Sessions: a whole number/));
  });

  it('shows Custom and Reset to default only for a customised plan', async () => {
    api.getPlanSettings.mockResolvedValue({ defaults: DEFAULT_PLANS, overrides: { gold: { limits: { smsUnits: 5000 } } }, effective: mergePlans({ gold: { limits: { smsUnits: 5000 } } }) });
    render(<PlanSettings />);
    const gold = await screen.findByTestId('plan-gold');
    expect(within(gold).getByText('Custom')).toBeTruthy();
    expect(within(screen.getByTestId('plan-silver')).queryByRole('button', { name: 'Reset to default' })).toBeNull();
    api.resetPlanSettings.mockResolvedValue({ ok: true });
    fireEvent.click(within(gold).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(api.resetPlanSettings).toHaveBeenCalledWith('gold'));
  });

  it('shows prices read-only', async () => {
    render(<PlanSettings />);
    const gold = await screen.findByTestId('plan-gold');
    expect(within(gold).getByText('KES 9,999/month')).toBeTruthy();
    expect(within(gold).queryByLabelText(/price/i)).toBeNull();
  });
});
