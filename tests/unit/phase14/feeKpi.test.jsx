import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { dayKey } from '@shared/utils/dates';

/**
 * "Collected this month" reads 0 once the month on the stored total has
 * passed, even before the new month's first payment resets it on the server.
 */
let data = {};
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((ref, next) => { next({ exists: () => true, data: () => data }); return () => {}; }),
}));
vi.mock('@services/firebase/config', () => ({ db: {} }));

afterEach(cleanup);

async function collected(aggregates) {
  data = aggregates;
  const { default: FeeKpiCards } = await import('@/features/fees/components/FeeKpiCards.jsx');
  render(<FeeKpiCards />);
  return screen.getByText('Collected this month').nextSibling.textContent;
}

describe('FeeKpiCards: collected this month', () => {
  it("shows this month's total", async () => {
    expect(await collected({ collectedThisMonth: 2500, collectedMonth: dayKey(new Date()).slice(0, 7) })).toMatch(/2,500/);
  });

  it("shows 0 when the total is an earlier month's", async () => {
    expect(await collected({ collectedThisMonth: 2500, collectedMonth: '2000-01' })).not.toMatch(/2,500/);
    expect(screen.getByText('Collected this month').nextSibling.textContent).toMatch(/\b0\b/);
  });

  it('a total without a month stamp is shown as is', async () => {
    expect(await collected({ collectedThisMonth: 300 })).toMatch(/300/);
  });
});
