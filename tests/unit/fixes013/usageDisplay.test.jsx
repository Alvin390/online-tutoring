import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageLevel, overallLevel, windowText, USAGE_WORDS } from '@features/billing/usage/usageLevels';
import UsageBars from '@features/billing/usage/UsageBars';
import UsageNotice from '@features/billing/usage/UsageNotice';
import { BillingContext } from '@features/billing/context/billingContextValue';

/**
 * 013Fixes / 12 — usage on the billing page, the superadmin page and a
 * dismissible dashboard notice at 100%. Soft limits: never "locked" or
 * "blocked"; nothing on any request path reads the usage to refuse anything.
 */

const usage = (over = {}) => ({
  activeStudents: 158, sessions: 2, logins: 2,
  limits: { activeStudents: 500, sessions: 10, logins: 10 },
  percent: { activeStudents: 32, sessions: 20, logins: 20 },
  windowStart: '2026-10-31T21:00:00.000Z', windowEnd: '2026-11-30T21:00:00.000Z', windowKind: 'month',
  countedAt: '2026-11-20T02:00:00.000Z',
  ...over,
});

describe('levels and words', () => {
  it('ok below 80, near from 80, over from 100', () => {
    expect(usageLevel(79)).toBe('ok');
    expect(usageLevel(80)).toBe('near');
    expect(usageLevel(99)).toBe('near');
    expect(usageLevel(100)).toBe('over');
    expect(usageLevel(150)).toBe('over');
    expect(overallLevel(usage({ percent: { activeStudents: 85, sessions: 20, logins: 20 } }))).toBe('near');
    expect(overallLevel(usage({ percent: { activeStudents: 85, sessions: 120, logins: 20 } }))).toBe('over');
  });

  it('never say locked or blocked', () => {
    for (const words of Object.values(USAGE_WORDS)) expect(words).not.toMatch(/lock|block|suspend/i);
    expect(USAGE_WORDS.over).toMatch(/continues normally/);
  });

  it('show the window as days in Nairobi', () => {
    expect(windowText(usage())).toBe('1 Nov – 30 Nov');
  });
});

describe('the bars', () => {
  it('each count of its limit, with no notice below 80%', () => {
    render(<UsageBars usage={usage()} />);
    expect(screen.getByTestId('usage-activeStudents').textContent).toMatch(/Active learners158 of 500/);
    expect(screen.queryByTestId('usage-notice')).toBeNull();
    expect(screen.getByText(/Counted daily/)).toBeTruthy();
  });

  it('the near notice at 80% and the over notice at 100%', () => {
    const { rerender } = render(<UsageBars usage={usage({ percent: { activeStudents: 85, sessions: 20, logins: 20 } })} />);
    expect(screen.getByTestId('usage-notice').textContent).toBe(USAGE_WORDS.near);
    rerender(<UsageBars usage={usage({ sessions: 3, percent: { activeStudents: 20, sessions: 150, logins: 20 } })} />);
    expect(screen.getByTestId('usage-notice').textContent).toBe(USAGE_WORDS.over);
  });

  it('says "Contact us for more logins" when every login is in use', () => {
    render(<UsageBars usage={usage({ logins: 10, percent: { activeStudents: 20, sessions: 20, logins: 100 } })} />);
    expect(screen.getByTestId('usage-logins-full').textContent).toMatch(/Contact us for more logins/);
  });
});

describe('the dashboard notice', () => {
  const show = (u) => render(
    <MemoryRouter>
      <BillingContext.Provider value={{ loading: false, plan: { usage: u } }}><UsageNotice /></BillingContext.Provider>
    </MemoryRouter>
  );
  beforeEach(() => localStorage.clear());

  it('only at 100% or more', () => {
    show(usage({ percent: { activeStudents: 90, sessions: 20, logins: 20 } }));
    expect(screen.queryByTestId('usage-banner')).toBeNull();
  });

  it('dismissed until the next count', () => {
    const over = usage({ percent: { activeStudents: 120, sessions: 20, logins: 20 } });
    const { unmount } = show(over);
    expect(screen.getByTestId('usage-banner').textContent).toMatch(/continues normally/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('usage-banner')).toBeNull();
    unmount();
    show(over);
    expect(screen.queryByTestId('usage-banner')).toBeNull();
    show({ ...over, countedAt: '2026-11-21T02:00:00.000Z' });
    expect(screen.getByTestId('usage-banner')).toBeTruthy();
  });
});

describe('nothing refuses because of usage', () => {
  it('only the status, the superadmin console and the counter touch config/usage', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'api');
    const readers = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (name.endsWith('.js') && readFileSync(full, 'utf8').includes("config/usage")) readers.push(full.replace(/\\/g, '/').split('/api/')[1]);
      }
    };
    walk(root);
    expect(readers.sort()).toEqual(['_lib/usage.js', 'admin/users.js', 'billing/status.js']);
  });
});
