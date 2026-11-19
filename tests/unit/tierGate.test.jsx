import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TierGate from '@shared/components/TierGate';
import { BillingContext } from '@features/billing/context/BillingContext';
import { DEFAULT_PLANS, PLAN_IDS } from '@shared/constants/plans';

/**
 * The client plan gate — Phase 12 follow-up; 013Fixes / 00.
 *
 * Pinned here:
 *
 * 1. The gate behaves like `requireFeature` in api/_lib/schoolPlan.js: the
 *    superadmin passes everything; otherwise the SCHOOL's plan must include
 *    the feature. The school's plan (from /api/billing/status) wins over the
 *    login's own claims; claims only stand in until it arrives.
 *
 * 2. Every plan feature a server endpoint checks has a client-side gate. A
 *    handler gaining a feature requirement with no matching gate is how a
 *    teacher ends up at "You do not have permission to do that." The scanner
 *    reads the handlers rather than a hardcoded list, so it notices.
 */

let authState = { tier: null, tierRank: 0, isSuperadmin: false };

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => authState,
}));

beforeEach(() => {
  authState = { tier: null, tierRank: 0, isSuperadmin: false };
});

const schoolPlan = (tier) => ({ tier, features: DEFAULT_PLANS[tier].features, limits: DEFAULT_PLANS[tier].limits });

const renderGate = (props, billing) => {
  const gate = (
    <MemoryRouter>
      <TierGate {...props}>
        <div data-testid="feature">the real panel</div>
      </TierGate>
    </MemoryRouter>
  );
  return render(billing ? <BillingContext.Provider value={billing}>{gate}</BillingContext.Provider> : gate);
};

describe('TierGate with the school plan', () => {
  it('renders the feature when the school plan includes it', () => {
    renderGate({ requires: 'fees', feature: 'Fee ledger' }, { loading: false, plan: schoolPlan('silver') });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('the school plan wins over a login\'s higher claim (a crafted or stale Gold claim on a Bronze school)', () => {
    authState = { tier: 'gold', tierRank: 3, isSuperadmin: false };
    renderGate({ requires: 'fees', feature: 'Fee ledger' }, { loading: false, plan: schoolPlan('bronze') });
    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Silver/)).toBeInTheDocument();
  });

  it('the school plan wins over a login with no claim at all (a new login on a Gold school)', () => {
    renderGate({ requires: 'targetedSms', feature: 'Choose recipients' }, { loading: false, plan: schoolPlan('gold') });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('uses the superadmin\'s plan settings the server returned', () => {
    const plan = schoolPlan('bronze');
    renderGate({ requires: 'fees', feature: 'Fee ledger' }, {
      loading: false, plan: { ...plan, features: { ...plan.features, fees: true } },
    });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('while the plan loads, a login with no claim sees nothing (never a wrong upgrade card)', () => {
    const { container } = renderGate({ requires: 'fees', feature: 'Fee ledger' }, { loading: true, plan: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('while the plan loads, the owner\'s claim stands in (no flash)', () => {
    authState = { tier: 'silver', tierRank: 2, isSuperadmin: false };
    renderGate({ requires: 'fees', feature: 'Fee ledger' }, { loading: true, plan: null });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('a failed status check falls back to the claim', () => {
    authState = { tier: 'bronze', tierRank: 1, isSuperadmin: false };
    renderGate({ requires: 'fees', feature: 'Fee ledger' }, { loading: false, plan: null });
    expect(screen.getByText(/Upgrade to Silver/)).toBeInTheDocument();
  });
});

describe('TierGate wording and the superadmin', () => {
  it('names the feature and the cheapest plan with its price', () => {
    authState = { tier: 'bronze', tierRank: 1, isSuperadmin: false };
    renderGate({ requires: 'mpesaStk', feature: 'M-Pesa payments' });
    expect(screen.getByText(/M-Pesa payments/)).toBeInTheDocument();
    expect(screen.getByText(/KES 9,999/)).toBeInTheDocument();
  });

  it('links to the billing page carrying the plan to upgrade to', () => {
    authState = { tier: 'bronze', tierRank: 1, isSuperadmin: false };
    renderGate({ requires: 'fees', feature: 'Fee ledger' });
    expect(screen.getByRole('link', { name: /Upgrade to Silver/ })).toHaveAttribute('href', '/billing');
  });

  it('lets a superadmin through regardless of any plan', () => {
    authState = { tier: null, tierRank: 0, isSuperadmin: true };
    renderGate({ requires: 'mpesaStk', feature: 'M-Pesa payments' }, { loading: false, plan: schoolPlan('bronze') });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('treats no plan as no plan, never as unlimited', () => {
    renderGate({ requires: 'sessions', feature: 'Custom sessions' });
    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
  });

  it('renders nothing for a feature no plan has', () => {
    authState = { tier: 'bronze', tierRank: 1, isSuperadmin: false };
    const { container } = renderGate({ requires: 'nonsense', feature: 'Nonsense' });
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every plan feature the server checks: `feature: 'x'` and requireFeature/hasFeature(user, 'x'). */
function serverFeatures(dir, found = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      serverFeatures(full, found);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const text = readFileSync(full, 'utf8');
    const file = full.replace(/\\/g, '/').split('/api/')[1];
    for (const m of text.matchAll(/^\s*feature:\s*'(\w+)'/gm)) found.set(`${file}#${m[1]}`, m[1]);
    for (const m of text.matchAll(/(?:requireFeature|hasFeature)\(\w+,\s*'(\w+)'/g)) found.set(`${file}#${m[1]}`, m[1]);
  }
  return found;
}

describe('server plan features have a client gate', () => {
  /** Endpoints with no panel. (013Fixes / 06: the WhatsApp campaign routes are retired and check no plan feature.) */
  const NO_PANEL = new Set();

  /**
   * Features reached only from inside another feature's panel. The panel's gate
   * covers them, which is right only while both are in exactly the same plans
   * (checked below).
   */
  const COVERED_BY = { invoices: 'fees' };

  it('finds the expected set of server checks', () => {
    expect([...serverFeatures(join(ROOT, 'api')).keys()].sort()).toEqual([
      'calendar/feedToken.js#calendar',
      'calendar/manage.js#calendar',
      'fees/annotate.js#fees',
      'fees/approveReceipt.js#feePayments',
      'fees/config.js#fees',
      'fees/generateInvoices.js#invoices',
      'fees/post.js#feePayments',
      'messages/sms.js#bulkSms',
      'messages/sms.js#targetedSms',
      'messages/sms.js#whatsappOneToOne',
      'sessions/manage.js#sessions',
      'students/bulk.js#feeBlocks',
      'students/bulk.js#feePayments',
      'students/scheduled.js#feeBlocks',
      'students/scheduled.js#scheduledBlocks',
    ]);
  });

  it('has a gate for every checked feature', () => {
    // What the UI actually declares, read from the components rather than
    // restated here — restating it would make this test agree with itself.
    const sources = [
      'src/features/dashboard/tabs/FeesOverviewTab.jsx',
      'src/features/dashboard/components/DashboardLayout.jsx',
      'src/features/dashboard/tabs/WhatsAppTab.jsx',
      'src/features/dashboard/tabs/CalendarTab.jsx',
      'src/features/dashboard/tabs/SetupTab.jsx',
      'src/features/dashboard/tabs/StaffTab.jsx',
      'src/features/dashboard/components/StudentDrawer.jsx',
      'src/features/dashboard/components/StudentTable.jsx',
      'src/features/dashboard/components/bulk/BulkActionModal.jsx',
      'src/features/dashboard/components/bulk/RecentActionsPanel.jsx',
      'src/features/sms/components/SmsComposer.jsx',
    ].map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');

    const gated = new Set([
      ...[...sources.matchAll(/<TierGate\s+requires="(\w+)"/g)].map((m) => m[1]),
      ...[...sources.matchAll(/\.has\('(\w+)'\)/g)].map((m) => m[1]),
    ]);

    for (const [where, feature] of serverFeatures(join(ROOT, 'api'))) {
      if (NO_PANEL.has(where)) continue;
      const gate = COVERED_BY[feature] ?? feature;
      expect(gated, `no client gate for "${feature}" (${where})`).toContain(gate);
    }
  });

  it('a covering gate is in exactly the same plans as what it covers', () => {
    for (const [covered, by] of Object.entries(COVERED_BY)) {
      for (const id of PLAN_IDS) {
        expect(DEFAULT_PLANS[id].features[covered], `${covered} vs ${by} on ${id}`).toBe(DEFAULT_PLANS[id].features[by]);
      }
    }
  });

  it('no screen gates on the login\'s own claims any more', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(entry.name)) continue;
        if (/auth[\\/]context[\\/]AuthContext\.jsx$/.test(full) || /billing[\\/]hooks[\\/]usePlan\.js$/.test(full)) continue;
        if (/tierRank/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
