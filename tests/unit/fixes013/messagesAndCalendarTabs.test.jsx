import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BillingContext } from '@features/billing/context/billingContextValue';
import { DEFAULT_PLANS } from '@shared/constants/plans';

/**
 * 013Fixes / 02 — the Calendar and Messages tabs open on every plan.
 * On Bronze the Messages tab is WhatsApp to one person, with an upgrade card
 * for SMS, and never loads the SMS setup; Silver and Gold keep SMS.
 */

let flags = {};
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tier: null, tierRank: 0, isSuperadmin: false }) }));
vi.mock('@features/sms/components/MessagesArea', () => ({
  default: ({ children }) => <div data-testid="sms-setup-area">{children({ unlockedAt: 'x' })}</div>,
}));
vi.mock('@features/sms/components/SmsComposer', () => ({
  default: ({ smsOff, smsOffReason }) => (
    <div data-testid="composer">{smsOff ? `whatsapp-only:${smsOffReason ?? 'off'}` : 'sms'}</div>
  ),
}));
vi.mock('@features/calendar/components/CalendarPanel', () => ({ default: () => <div data-testid="calendar-panel" /> }));

const { default: WhatsAppTab } = await import('@features/dashboard/tabs/WhatsAppTab');
const { default: CalendarTab } = await import('@features/dashboard/tabs/CalendarTab');

const plan = (tier) => ({ loading: false, plan: { tier, features: DEFAULT_PLANS[tier].features, limits: DEFAULT_PLANS[tier].limits } });
const show = (ui, tier) => render(
  <MemoryRouter><BillingContext.Provider value={plan(tier)}>{ui}</BillingContext.Provider></MemoryRouter>
);

beforeEach(() => { flags = { 'sms.enabled': true, 'calendar.enabled': true }; });

describe('Messages tab', () => {
  it('Bronze: WhatsApp to one person, SMS shown as an upgrade, no SMS setup loaded', async () => {
    show(<WhatsAppTab preset={{ version: 0, preset: null }} />, 'bronze');
    expect((await screen.findByTestId('composer')).textContent).toBe('whatsapp-only:plan');
    expect(screen.queryByTestId('sms-setup-area')).toBeNull();
    expect(screen.queryByText(/Upgrade to Silver/)).toBeNull(); // the tab itself is not locked
  });

  for (const tier of ['silver', 'gold']) {
    it(`${tier}: the SMS setup and composer as before`, async () => {
      show(<WhatsAppTab preset={{ version: 0, preset: null }} />, tier);
      expect(await screen.findByTestId('sms-setup-area')).toBeInTheDocument();
      expect(screen.getByTestId('composer').textContent).toBe('sms');
    });
  }

  it('SMS switched off: WhatsApp only, for the "off" reason, on any plan', async () => {
    flags = { 'sms.enabled': false };
    show(<WhatsAppTab preset={{ version: 0, preset: null }} />, 'gold');
    expect((await screen.findByTestId('composer')).textContent).toBe('whatsapp-only:off');
  });
});

describe('Calendar tab', () => {
  for (const tier of ['bronze', 'silver', 'gold']) {
    it(`${tier}: the calendar, not an upgrade card`, async () => {
      show(<CalendarTab />, tier);
      expect(await screen.findByTestId('calendar-panel')).toBeInTheDocument();
      expect(screen.queryByText(/Upgrade to/)).toBeNull();
    });
  }
});
