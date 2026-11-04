import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import { buildIndex, searchStudents, DEFAULT_SEARCH_STATE, STATUS_KEYS, STATUS_LABELS } from '@features/dashboard/search/studentSearch';
import { sanitizeSearch, filtersFromParams, paramsForState } from '@features/dashboard/search/searchState';
import { partialSummary } from '@features/fees/partialSummary';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 006Fixes / 08 — the "Partial payment" filter (owner, 4 Nov 2026): students
 * approved on a partial payment who still owe, so the teacher can select them
 * and block (now or scheduled). Plus the row badge (live balance), and a KPI
 * line of how many are on partial payment and what they owe.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25, delete: 12 },
  runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(), runSchedule: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false, user: { email: 't@school.example' } }) }));

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const marker = (paid, owedBefore) => ({ paid, owedBefore, owedAfter: owedBefore - paid, at: at(Date.parse('2026-11-02T16:00:00Z')), by: 'uid' });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const roster = [
  kid(1, 'Claire Job', { feeBalance: 1550, partialPayment: marker(1200, 2750) }),
  // A later charge since the partial approval: the live balance is what counts.
  kid(2, 'Sheila Wanjiru', { feeBalance: 4000, partialPayment: marker(1500, 2750) }),
  // Paid off but the marker not yet removed: not partial.
  kid(3, 'Bryan Paid', { feeBalance: 0, partialPayment: marker(1100, 2750) }),
  // Owes, never approved on a partial payment.
  kid(4, 'Dan Owes', { feeBalance: 2750 }),
  kid(5, 'Esther Clear'),
];

describe('the partial flag', () => {
  it('is a status chip, after "Owes fees", labelled "Partial payment"', () => {
    expect(STATUS_KEYS.indexOf('partial')).toBe(STATUS_KEYS.indexOf('owes') + 1);
    expect(STATUS_LABELS.partial).toBe('Partial payment');
  });

  it('is true only with the marker AND something still owed', () => {
    const index = buildIndex(roster, 'evening');
    const out = searchStudents(index, { ...DEFAULT_SEARCH_STATE, statuses: ['partial'] });
    expect(out.results.map((s) => s.studentName).sort()).toEqual(['Claire Job', 'Sheila Wanjiru']);
    expect(out.facets.status.partial).toBe(2);
    expect(out.facets.status.owes).toBe(3);
  });

  it('survives the URL and saved-search round trip', () => {
    expect(sanitizeSearch({ statuses: ['partial'] }).statuses).toEqual(['partial']);
    const params = paramsForState({ ...DEFAULT_SEARCH_STATE, statuses: ['partial'] }, new URLSearchParams());
    expect(filtersFromParams(params).statuses).toEqual(['partial']);
  });
});

function renderPanel() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel session="evening" sessionDoc={{ id: 'evening', name: 'Evening', classes: ['Form 3'], schedule: { days: [], tz: 'Africa/Nairobi', startTime: '18:30', endTime: '20:30' } }}
          students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </MemoryRouter>
    </ToastProvider>
  );
}
const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

describe('on the dashboard', () => {
  it('the chip shows its count and filters; selecting them offers Block (now or scheduled)', async () => {
    renderPanel();
    expect(statusChip('Partial payment').textContent).toMatch(/2/);
    fireEvent.click(statusChip('Partial payment'));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(2));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all students on this page' }));
    const bar = await screen.findByRole('region', { name: 'Selected students' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Block selected' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Now' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Schedule' })).toBeTruthy();
  });

  it('the row badge shows the LIVE balance, not the figure at approval', () => {
    renderPanel();
    const badges = screen.getAllByTestId('partial-badge').map((b) => b.textContent);
    expect(badges).toEqual(expect.arrayContaining(['Partial: owes KES 1,550', 'Partial: owes KES 4,000']));
    expect(badges).toHaveLength(2);
  });
});

describe('the KPI line', () => {
  it('counts partial payers and what they owe, per session', () => {
    const summary = partialSummary({ evening: roster, morning: [kid(9, 'Ryan', { feeBalance: 1650, partialPayment: marker(1100, 2750) })] });
    expect(summary).toEqual({ count: 3, owed: 7200, bySession: { evening: { count: 2, owed: 5550 }, morning: { count: 1, owed: 1650 } } });
    expect(partialSummary({})).toEqual({ count: 0, owed: 0, bySession: {} });
  });
});

describe('the KPI cards and the drawer line', () => {
  it('FeeKpiCards shows "N on partial payment owe KES X", and per session', async () => {
    vi.resetModules();
    vi.doMock('firebase/firestore', () => ({
      doc: vi.fn(() => ({})),
      onSnapshot: vi.fn((ref, next) => { next({ exists: () => true, data: () => ({ totalOutstanding: 8250, bySession: { evening: { totalOutstanding: 5550 } } }) }); return () => {}; }),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    const { default: FeeKpiCards } = await import('@/features/fees/components/FeeKpiCards.jsx');
    render(<FeeKpiCards sessions={[{ slug: 'evening', name: 'Evening' }, { slug: 'morning', name: 'Morning' }]} partial={{ count: 3, owed: 7200, bySession: { evening: { count: 2, owed: 5550 } } }} />);
    expect(screen.getByTestId('fee-kpi-partial').textContent).toBe('3 on partial payment owe KES 7,200');
    const lines = screen.getAllByTestId('fee-kpi-session').map((l) => l.textContent);
    expect(lines[0]).toMatch(/· 2 on partial payment$/);
    expect(lines[1]).not.toMatch(/partial/);
    vi.doUnmock('firebase/firestore');
  });

  it('no partial payers: no line', async () => {
    vi.resetModules();
    vi.doMock('firebase/firestore', () => ({
      doc: vi.fn(() => ({})),
      onSnapshot: vi.fn((ref, next) => { next({ exists: () => true, data: () => ({}) }); return () => {}; }),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    const { default: FeeKpiCards } = await import('@/features/fees/components/FeeKpiCards.jsx');
    render(<FeeKpiCards sessions={[]} partial={{ count: 0, owed: 0, bySession: {} }} />);
    expect(screen.queryByTestId('fee-kpi-partial')).toBeNull();
    vi.doUnmock('firebase/firestore');
  });

  it('the drawer\'s fee tab says what the partial payment was', async () => {
    const { partialLine } = await import('@features/fees/partialSummary');
    expect(partialLine({ paid: 1200, owedBefore: 2750, at: at(Date.parse('2026-11-02T16:00:00Z')) }, 1550)).toBe('Paid KES 1,200 of 2,750 on 2 Nov (partial)');
    expect(partialLine({ paid: 1200, owedBefore: 2750 }, 0)).toBeNull();
    expect(partialLine(null, 1550)).toBeNull();
  });
});

describe('the row re-renders when the marker appears (memo compares it by value)', () => {
  it('a marker added with the same balance shows the badge', async () => {
    const { rerender } = renderPanel();
    expect(screen.queryAllByTestId('partial-badge')).toHaveLength(2);
    const noop = vi.fn();
    const next = roster.map((s) => (s.studentName === 'Dan Owes' ? { ...s, partialPayment: marker(1000, 3750) } : s));
    rerender(
      <ToastProvider>
        <MemoryRouter>
          <StudentSearchPanel session="evening" sessionDoc={{ id: 'evening', name: 'Evening', classes: ['Form 3'], schedule: { days: [], tz: 'Africa/Nairobi', startTime: '18:30', endTime: '20:30' } }}
            students={next} loading={false}
            onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
        </MemoryRouter>
      </ToastProvider>
    );
    await waitFor(() => expect(screen.queryAllByTestId('partial-badge')).toHaveLength(3));
  });
});
