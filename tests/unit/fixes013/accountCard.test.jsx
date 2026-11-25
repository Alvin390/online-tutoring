import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import AccountCard from '@/features/admin/components/AccountCard';
import { planLosses, endOfNairobiDay, daysLeftText, statusBadge } from '@/features/admin/accountCardText';
import { DEFAULT_PLANS } from '@shared/constants/plans';

/**
 * 013Fixes / 22b — the account card at the top of Accounts: the plan, its
 * status and days left, the end, a month waiting, the last payment, the SMS
 * units; the actions, each confirmed; the private notes; the school's own
 * limits and features.
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminBilling', () => ({
  changeSchoolPlan: (...a) => api.changeSchoolPlan(...a),
  extendSchool: (...a) => api.extendSchool(...a),
  lockSchool: (...a) => api.lockSchool(...a),
  unlockSchool: (...a) => api.unlockSchool(...a),
  getAccountNotes: (...a) => api.getAccountNotes(...a),
  saveAccountNotes: (...a) => api.saveAccountNotes(...a),
  saveSchoolOverrides: (...a) => api.saveSchoolOverrides(...a),
  giftSchoolPlan: (...a) => api.giftSchoolPlan(...a),
  cancelSchoolPlan: (...a) => api.cancelSchoolPlan(...a),
}));

const D = 86_400_000;
const NOW = Date.now();
const plans = Object.fromEntries(['bronze', 'silver', 'gold'].map((id) => [id, { features: DEFAULT_PLANS[id].features, limits: DEFAULT_PLANS[id].limits }]));
const base = {
  tier: 'gold', status: 'active', grantedBySuperadmin: false, renewalMode: 'manual', card: false, renews: false,
  endsAt: NOW + 12 * D + 3_600_000, countdownFrom: NOW + 10 * D, nextPeriodStart: null, nextTier: null,
  cancelAtPeriodEnd: false, lastPaymentAt: Date.parse('2026-11-10T07:00:00Z'), lastPaymentAmountKes: 5000,
  lastPaymentMethod: 'mpesa', schoolOverrides: { limits: {}, features: {} }, custom: false,
};

beforeEach(() => {
  for (const k of ['changeSchoolPlan', 'extendSchool', 'lockSchool', 'unlockSchool', 'saveAccountNotes', 'saveSchoolOverrides', 'giftSchoolPlan', 'cancelSchoolPlan']) {
    api[k] = vi.fn().mockResolvedValue({ ok: true });
  }
  api.getAccountNotes = vi.fn().mockResolvedValue({ notes: null, history: [] });
});
afterEach(() => { cleanup(); });

function renderCard(sub = {}) {
  const onChanged = vi.fn();
  render(<AccountCard subscription={{ ...base, ...sub }} plans={plans} sms={{ available: 1234 }} onChanged={onChanged} />);
  return onChanged;
}
const click = async (name) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const dialog = () => screen.getByTestId('account-dialog');

describe('the wording', () => {
  it('what a downgrade loses: features and lower limits', () => {
    const l = planLosses(plans, 'gold', 'bronze');
    expect(l.features.length).toBeGreaterThan(0);
    expect(l.limits.map((x) => x.label)).toContain('SMS units a month');
    expect(planLosses(plans, 'bronze', 'gold')).toEqual({ features: [], limits: [] });
  });

  it('a picked day ends at 23:59 in Nairobi; days left; the status', () => {
    expect(new Date(endOfNairobiDay('2026-12-03')).toISOString()).toBe('2026-12-03T20:59:00.000Z');
    expect(endOfNairobiDay('3/12/2026')).toBeNull();
    expect(daysLeftText({ ...base, endsAt: NOW + 2.5 * D }, NOW)).toBe('3 days left');
    expect(daysLeftText({ ...base, status: 'locked' }, NOW)).toBeNull();
    expect(statusBadge({ status: 'active', grantedBySuperadmin: true }).text).toBe('Gifted');
  });
});

describe('the card', () => {
  it('plan, status, days left, the end, a month waiting, the last payment, SMS units, custom', () => {
    renderCard({ nextPeriodStart: NOW + 12 * D, nextTier: 'silver', custom: true });
    expect(screen.getByTestId('account-plan').textContent).toBe('Gold');
    expect(screen.getByTestId('account-status').textContent).toBe('Active');
    expect(screen.getByTestId('account-days-left').textContent).toBe('13 days left');
    expect(screen.getByTestId('account-end').textContent).toMatch(/\d{4}/);
    expect(screen.getByTestId('account-next').textContent).toMatch(/^Silver from /);
    expect(screen.getByTestId('account-last-payment').textContent).toBe('KES 5,000 by M-Pesa on 10 Nov 2026');
    expect(screen.getByTestId('account-sms').textContent).toBe('1,234 left');
    expect(screen.getByTestId('account-custom')).toBeTruthy();
  });

  it('Change plan to a cheaper one warns what the school loses, then changes it', async () => {
    const onChanged = renderCard();
    await click('Change plan');
    fireEvent.change(within(dialog()).getByLabelText('Plan'), { target: { value: 'bronze' } });
    expect(screen.getByTestId('downgrade-warning').textContent).toMatch(/The school loses/);
    // The dialog's own button (the card's is behind it).
    const buttons = screen.getAllByRole('button', { name: 'Change plan' });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(api.changeSchoolPlan).toHaveBeenCalledWith('bronze');
    expect(onChanged).toHaveBeenCalledWith('Plan changed to Bronze.');
  });

  it('Extend shows where the end moves to, then extends', async () => {
    renderCard();
    await click('Extend by days');
    fireEvent.change(screen.getByLabelText('Days to add'), { target: { value: '10' } });
    expect(dialog().textContent).toMatch(/The end moves from .+ to .+\./);
    await click('Extend');
    expect(api.extendSchool).toHaveBeenCalledWith(10);
  });

  it('a card school: Change plan and Extend are off, and the card says why', () => {
    renderCard({ card: true, renews: true });
    expect(screen.getByRole('button', { name: 'Change plan' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Extend by days' }).disabled).toBe(true);
    expect(screen.getByText(/Paying by card/)).toBeTruthy();
  });

  it('Lock now is confirmed in plain words', async () => {
    renderCard();
    await click('Lock now');
    expect(dialog().textContent).toMatch(/lose access straight away/);
    const buttons = screen.getAllByRole('button', { name: 'Lock now' });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(api.lockSchool).toHaveBeenCalled();
  });

  it('locked: Unlock until a day (23:59 Nairobi); no Lock, Extend or Cancel', async () => {
    renderCard({ status: 'locked' });
    expect(screen.queryByRole('button', { name: 'Lock now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Extend by days' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await click('Unlock until…');
    const day = new Date(NOW + 5 * D).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('Open until'), { target: { value: day } });
    await click('Unlock');
    expect(api.unlockSchool).toHaveBeenCalledWith(endOfNairobiDay(day));
  });

  it('Gift plan and Cancel go through /api/billing/manage (grant, cancel)', async () => {
    renderCard();
    await click('Gift plan');
    fireEvent.change(within(dialog()).getByLabelText('Plan'), { target: { value: 'silver' } });
    const gift = screen.getAllByRole('button', { name: 'Gift plan' });
    await act(async () => { fireEvent.click(gift[gift.length - 1]); });
    expect(api.giftSchoolPlan).toHaveBeenCalledWith('silver');
    await click('Cancel');
    await click('Cancel at the end');
    expect(api.cancelSchoolPlan).toHaveBeenCalled();
  });

  it('a refusal is shown in the server\'s words, in the dialog', async () => {
    api.lockSchool.mockRejectedValueOnce(new Error('This school has no subscription yet. Start a trial first.'));
    renderCard();
    await click('Lock now');
    const buttons = screen.getAllByRole('button', { name: 'Lock now' });
    await act(async () => { fireEvent.click(buttons[buttons.length - 1]); });
    expect(screen.getByRole('alert').textContent).toMatch(/no subscription yet/);
  });
});

describe('notes and custom limits', () => {
  it('notes load when opened, save, and list what changed', async () => {
    api.getAccountNotes
      .mockResolvedValueOnce({ notes: { contact: 'Placeholder Person', agreedPrice: '', promises: '' }, history: [] })
      .mockResolvedValueOnce({ notes: { contact: 'Placeholder Person', agreedPrice: 'KES 2,000', promises: '' }, history: [{ at: Date.parse('2026-11-25T08:00:00Z'), actor: 'a', before: { agreedPrice: '' }, after: { agreedPrice: 'KES 2,000' } }] });
    renderCard();
    await click('Notes');
    expect(screen.getByLabelText('Contact person').value).toBe('Placeholder Person');
    expect(screen.getByRole('button', { name: 'Save notes' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Agreed price'), { target: { value: 'KES 2,000' } });
    await click('Save notes');
    expect(api.saveAccountNotes).toHaveBeenCalledWith({ contact: 'Placeholder Person', agreedPrice: 'KES 2,000', promises: '' });
    expect(screen.getByTestId('notes-history').textContent).toMatch(/Agreed price changed/);
  });

  it('custom limits: only what is filled in is sent; all empty goes back to the plan', async () => {
    const onChanged = renderCard({ schoolOverrides: { limits: { smsUnits: 900 }, features: {} } });
    await click('Custom limits');
    const form = screen.getByTestId('school-overrides');
    expect(within(form).getByLabelText('SMS units a month').value).toBe('900');
    fireEvent.change(within(form).getByLabelText('Dashboard logins'), { target: { value: '7' } });
    fireEvent.change(within(form).getByLabelText('Fees (ledger, balances)'), { target: { value: 'off' } });
    api.saveSchoolOverrides.mockResolvedValueOnce({ ok: true, custom: true });
    await click('Save custom limits');
    expect(api.saveSchoolOverrides).toHaveBeenLastCalledWith({ limits: { smsUnits: 900, logins: 7 }, features: { fees: false } });
    expect(onChanged).toHaveBeenLastCalledWith('Custom limits saved.');
  });

  it('a limit that is not a whole number is refused on the form', async () => {
    renderCard();
    await click('Custom limits');
    fireEvent.change(screen.getByLabelText('Dashboard logins'), { target: { value: 'seven' } });
    await click('Save custom limits');
    expect(screen.getByRole('alert').textContent).toMatch(/Dashboard logins: a whole number/);
    expect(api.saveSchoolOverrides).not.toHaveBeenCalled();
  });
});
