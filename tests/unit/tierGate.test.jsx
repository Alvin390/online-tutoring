import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TierGate from '@shared/components/TierGate';

/**
 * The client tier gate — Phase 12 follow-up.
 *
 * Two separate things are pinned here, and the second matters more than the
 * first.
 *
 * 1. The gate behaves like `requireTier` in api/_lib/auth.js: superadmin passes
 *    everything, otherwise tierRank must reach the required rank.
 *
 * 2. Every endpoint that declares a `tier:` has a client-side counterpart. A
 *    handler gaining a tier requirement with no matching gate is exactly how a
 *    Bronze teacher ends up back at "You do not have permission to do that." —
 *    the failure this component exists to prevent. The scanner below reads the
 *    handlers rather than a hardcoded list, so it notices.
 */

let authState = { tierRank: 0, isSuperadmin: false };

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => authState,
}));

beforeEach(() => {
  authState = { tierRank: 0, isSuperadmin: false };
});

const renderGate = (props) =>
  render(
    <MemoryRouter>
      <TierGate {...props}>
        <div data-testid="feature">the real panel</div>
      </TierGate>
    </MemoryRouter>
  );

describe('TierGate', () => {
  it('renders the feature when the tier is high enough', () => {
    authState = { tierRank: 2, isSuperadmin: false };
    renderGate({ tier: 'silver', feature: 'Fee ledger' });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('renders the feature when the tier is above what is required', () => {
    authState = { tierRank: 3, isSuperadmin: false };
    renderGate({ tier: 'silver', feature: 'Fee ledger' });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('replaces the feature with an upgrade prompt below the tier', () => {
    authState = { tierRank: 1, isSuperadmin: false };
    renderGate({ tier: 'silver', feature: 'Fee ledger' });

    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
    expect(screen.getByText(/Upgrade to Silver/)).toBeInTheDocument();
  });

  it('names the feature and the plan price, so the prompt is actionable', () => {
    authState = { tierRank: 1, isSuperadmin: false };
    renderGate({ tier: 'gold', feature: 'M-Pesa payments' });

    expect(screen.getByText(/M-Pesa payments/)).toBeInTheDocument();
    expect(screen.getByText(/KES 9,999/)).toBeInTheDocument();
  });

  it('links to the billing page carrying the tier to upgrade to', () => {
    authState = { tierRank: 1, isSuperadmin: false };
    renderGate({ tier: 'silver', feature: 'Fee ledger' });

    expect(screen.getByRole('link', { name: /Upgrade to Silver/ }))
      .toHaveAttribute('href', '/billing');
  });

  it('lets a superadmin through regardless of tierRank', () => {
    // Mirrors api/_lib/auth.js:109 — there is no support scenario where the
    // owner should be locked out of their customer's dashboard.
    authState = { tierRank: 0, isSuperadmin: true };
    renderGate({ tier: 'gold', feature: 'M-Pesa payments' });
    expect(screen.getByTestId('feature')).toBeInTheDocument();
  });

  it('treats a missing tierRank as no tier rather than as unlimited', () => {
    authState = { tierRank: undefined, isSuperadmin: false };
    renderGate({ tier: 'bronze', feature: 'Custom sessions' });
    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
  });

  it('refuses to render a prompt for a tier that does not exist', () => {
    authState = { tierRank: 1, isSuperadmin: false };
    const { container } = renderGate({ tier: 'platinum', feature: 'Nonsense' });
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------

/** Every `tier: '<x>'` declared by a handler under api/. */
function handlerTiers(dir, found = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      handlerTiers(full, found);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const match = readFileSync(full, 'utf8').match(/^\s*tier:\s*'(\w+)'/m);
    if (match) found.set(full.replace(/\\/g, '/').split('/api/')[1], match[1]);
  }
  return found;
}

describe('server tier requirements have a client gate', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /**
   * Handlers a teacher never reaches from a gated panel.
   *
   * `daraja/credentials.js` is Gold and has no caller in src/ at all — the
   * Phase 09 settings form was never built. Listed here so this test documents
   * the gap instead of failing on it; remove the entry when the panel lands.
   */
  const NO_PANEL_YET = new Set(['daraja/credentials.js']);

  it('finds the expected set of tier-gated endpoints', () => {
    const tiers = handlerTiers(join(ROOT, 'api'));
    expect([...tiers.keys()].sort()).toEqual([
      'calendar/feedToken.js',
      'calendar/manage.js',
      'daraja/credentials.js',
      'fees/config.js',
      'fees/generateInvoices.js',
      'fees/post.js',
      'sessions/manage.js',
      'whatsapp/campaign.js',
      'whatsapp/upload.js',
    ]);
  });

  it('has a TierGate at the matching tier for every gated area', () => {
    const tiers = handlerTiers(join(ROOT, 'api'));

    // What the UI actually declares, read from the components rather than
    // restated here — restating it would make this test agree with itself.
    const sources = [
      'src/features/dashboard/components/DashboardLayout.jsx',
      'src/features/dashboard/components/StudentDrawer.jsx',
      'src/features/whatsapp/components/WhatsAppPanel.jsx',
    ].map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');

    // Two spellings count. `<TierGate>` is the general one; WhatsAppPanel
    // predates it and gates its Gold controls inline with a rank comparison,
    // because it disables individual controls rather than replacing a whole
    // panel. Both are real gates, so both are accepted.
    const RANK_TO_TIER = { 1: 'bronze', 2: 'silver', 3: 'gold' };

    const gated = new Set([
      ...[...sources.matchAll(/<TierGate\s+tier="(\w+)"/g)].map((m) => m[1]),
      ...[...sources.matchAll(/tierRank\s*\?\?\s*0\)\s*>=\s*(\d)/g)]
        .map((m) => RANK_TO_TIER[m[1]])
        .filter(Boolean),
    ]);

    const needed = new Set(
      [...tiers.entries()].filter(([file]) => !NO_PANEL_YET.has(file)).map(([, tier]) => tier)
    );

    for (const tier of needed) {
      expect(gated, `no <TierGate tier="${tier}"> in the dashboard`).toContain(tier);
    }
  });
});
