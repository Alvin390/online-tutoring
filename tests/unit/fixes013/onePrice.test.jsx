import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS } from '@shared/constants/tiers';
import { UpgradePrompt } from '@shared/components/TierGate';
import { BillingContext } from '@features/billing/context/billingContextValue';
import RecordPaymentModal from '@/features/admin/components/RecordPaymentModal';
import AccountCard from '@/features/admin/components/AccountCard';
import * as paystack from '../../../api/_lib/paystack.js';

/**
 * 013Fixes / 27 — one price everywhere: the screens show the server's price
 * (the shared Paystack plans, from the status call or the Accounts list) and
 * no price is written into the app's code; the server keeps the code prices
 * only as its last fallback, named so.
 */

vi.mock('@services/api/adminBilling', () => ({ recordSchoolPayment: vi.fn() }));
afterEach(() => cleanup());

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src');
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(js|jsx)$/.test(name) ? [p] : [];
  });
}

describe('no price is written into the app', () => {
  it('no 4,999 / 7,499 / 9,999 anywhere in src/', () => {
    const hits = files(ROOT).filter((f) => /\b(4,?999|7,?499|9,?999)\b/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it('the plans carry no price; the server\'s code prices are the named fallback', () => {
    for (const t of ['bronze', 'silver', 'gold']) expect(TIERS[t]).not.toHaveProperty('priceKes');
    expect(paystack.FALLBACK_PRICE_KES).toEqual({ bronze: 4999, silver: 7499, gold: 9999 });
    expect(paystack).not.toHaveProperty('TIER_PRICE_KES');
  });
});

describe('the screens show the server\'s price', () => {
  const prices = { bronze: 5000, silver: 8000, gold: 12000 };
  const prompt = (billing) => render(
    <BillingContext.Provider value={billing}><MemoryRouter><UpgradePrompt tier="gold" feature="M-Pesa payments" /></MemoryRouter></BillingContext.Provider>,
  );

  it('the upgrade prompt: the plan\'s price from the status call', () => {
    prompt({ loading: false, plan: { tier: 'bronze', prices } });
    expect(screen.getByText(/available on the Gold plan at KES 12,000\/month/)).toBeTruthy();
  });

  it('…and no price at all while it isn\'t known (never a stale one)', () => {
    prompt({ loading: true, plan: null });
    expect(screen.getByText(/available on the Gold plan\./)).toBeTruthy();
    expect(screen.queryByText(/KES/)).toBeNull();
  });

  it('Record payment: the amount starts at the package\'s price, and follows the package until typed', () => {
    render(<RecordPaymentModal currentTier="silver" prices={prices} onClose={() => {}} />);
    expect(screen.getByLabelText('Amount (KES)').value).toBe('8000');
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'gold' } });
    expect(screen.getByLabelText('Amount (KES)').value).toBe('12000');
    fireEvent.change(screen.getByLabelText('Amount (KES)'), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'bronze' } });
    expect(screen.getByLabelText('Amount (KES)').value).toBe('6000');
  });

  it('the account card: the plan\'s price', () => {
    render(<AccountCard subscription={{ tier: 'gold', status: 'active', endsAt: Date.now() + 86_400_000, schoolOverrides: { limits: {}, features: {} } }} plans={null} sms={null} prices={prices} />);
    expect(screen.getByTestId('account-price').textContent).toBe('KES 12,000 a month');
  });
});
