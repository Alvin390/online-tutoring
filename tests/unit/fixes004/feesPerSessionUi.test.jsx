import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, renderHook } from '@testing-library/react';
import { dayKey } from '@shared/utils/dates';

/**
 * 004Fixes / 09 — the dashboard on the per-session fee account:
 *   - the student drawer's statement listens to `{session}__{phone}`;
 *   - the KPI cards add one line per session (owner: "per session is also
 *     good"), from `aggregates/dashboard.bySession`.
 */

let data = {};
const fs = vi.hoisted(() => ({
  doc: vi.fn((...path) => ({ path: path.slice(1).join('/') })),
  collection: vi.fn((...path) => ({ path: path.slice(1).join('/') })),
  query: vi.fn((ref) => ref),
  orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: vi.fn(),
}));
vi.mock('firebase/firestore', () => fs);
vi.mock('@services/firebase/config', () => ({ db: {} }));
vi.mock('@services/api/fees', () => ({
  getFeeSummary: vi.fn(async () => ({ feesEnabled: true, summary: { balance: 0 } })),
  recordPayment: vi.fn(), reverseLedgerEntry: vi.fn(), annotateLedgerEntry: vi.fn(),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));

beforeEach(() => {
  fs.onSnapshot.mockReset();
  fs.onSnapshot.mockImplementation((ref, next) => {
    next({ exists: () => true, data: () => data, docs: [], docChanges: () => [] });
    return () => {};
  });
  fs.doc.mockClear();
  fs.collection.mockClear();
});
afterEach(cleanup);

const THIS_MONTH = dayKey(new Date()).slice(0, 7);
const SESSIONS = [{ slug: 'morning', name: 'Morning' }, { slug: 'evening', name: 'Evening' }, { slug: 'after-school', name: 'After school' }];

async function renderCards(aggregates, sessions = SESSIONS) {
  data = aggregates;
  const { default: FeeKpiCards } = await import('@/features/fees/components/FeeKpiCards.jsx');
  render(<FeeKpiCards sessions={sessions} />);
  return screen.queryAllByTestId('fee-kpi-session').map((el) => el.textContent.replace(/\s+/g, ' ').trim());
}

describe('KPI cards: money per session', () => {
  it('one line per session: outstanding and collected this month', async () => {
    const lines = await renderCards({
      totalOutstanding: 4250, collectedThisMonth: 1500, collectedMonth: THIS_MONTH,
      bySession: {
        morning: { totalOutstanding: 1500, collectedThisMonth: 1500, collectedMonth: THIS_MONTH },
        evening: { totalOutstanding: 2750 },
      },
    });
    expect(lines[0]).toMatch(/^Morning: KES 1,500 outstanding · KES 1,500 this month$/);
    expect(lines[1]).toMatch(/^Evening: KES 2,750 outstanding · KES 0 this month$/);
    // No fee activity yet: 0 and 0.
    expect(lines[2]).toMatch(/^After school: KES 0 outstanding · KES 0 this month$/);
    // The school totals are unchanged.
    expect(screen.getByText('Total outstanding').nextSibling.textContent).toMatch(/4,250/);
  });

  it('an earlier month\'s collected total reads 0 for that session; credit reads 0 outstanding', async () => {
    const lines = await renderCards({
      bySession: { morning: { totalOutstanding: -300, collectedThisMonth: 999, collectedMonth: '2000-01' } },
    }, SESSIONS.slice(0, 1));
    expect(lines).toEqual(['Morning: KES 0 outstanding · KES 0 this month']);
  });

  it('without a session list, only the school totals show (as before)', async () => {
    data = { totalOutstanding: 100 };
    const { default: FeeKpiCards } = await import('@/features/fees/components/FeeKpiCards.jsx');
    render(<FeeKpiCards />);
    expect(screen.queryAllByTestId('fee-kpi-session')).toHaveLength(0);
    expect(screen.getByText('Total outstanding')).toBeTruthy();
  });
});

describe('the student statement listens to that registration\'s account', () => {
  it('evening row: fees/accounts/items/evening__{phone} and its ledger', async () => {
    data = { balance: 2750 };
    const { useStudentFees } = await import('@/features/fees/hooks/useStudentFees.js');
    renderHook(() => useStudentFees({ session: 'evening', phone: '+254711009009', enabled: true }));
    const paths = [...fs.doc.mock.calls, ...fs.collection.mock.calls].map((args) => args.slice(1).join('/'));
    expect(paths).toContain('fees/accounts/items/evening__+254711009009');
    expect(paths).toContain('fees/accounts/items/evening__+254711009009/ledger');
    expect(paths.some((p) => p.startsWith('fees/accounts/items/+254711009009'))).toBe(false);
  });

  it('no session yet: no listener at all (never a phone-only path)', async () => {
    const { useStudentFees } = await import('@/features/fees/hooks/useStudentFees.js');
    renderHook(() => useStudentFees({ session: null, phone: '+254711009009', enabled: true }));
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });
});
