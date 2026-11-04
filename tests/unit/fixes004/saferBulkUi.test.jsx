import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 004Fixes / 05 — safer bulk actions (owner decisions, 1 Nov 2026):
 *   - "Now" stays preselected, but the confirmation says plainly that it
 *     starts now (and charges now), on the panel and on the button;
 *   - the toast's Undo works only on a double-click, and says so;
 *   - Recent actions says who undid an action, and when.
 */

const api = vi.hoisted(() => {
  class BulkInterrupted extends Error {}
  return {
    BulkInterrupted,
    DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25 },
    runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(), listBulkItems: vi.fn(),
    runSchedule: vi.fn(), removeFromSchedule: vi.fn(), listSchedules: vi.fn(), rescheduleSchedule: vi.fn(), cancelSchedule: vi.fn(),
  };
});
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false, user: { uid: 'a', email: 'teacher.a@school.example' } }),
}));

beforeEach(() => {
  sessionStorage.clear();
  for (const fn of Object.values(api)) if (fn?.mockReset) fn.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000),
});
const roster = [kid(1, 'Amina Wanjiru'), kid(2, 'Brian Otieno'), kid(3, 'Chebet Kiprop')];

function renderList() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'], schedule: { days: [], tz: 'Africa/Nairobi', startTime: '08:30', endTime: '10:30' } }}
          students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </MemoryRouter>
    </ToastProvider>
  );
}

async function openBlockForm(names = ['Amina Wanjiru', 'Brian Otieno']) {
  for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
  fireEvent.click(within(await screen.findByRole('region', { name: 'Selected students' })).getByRole('button', { name: 'Block selected' }));
  return screen.findByRole('dialog');
}

describe('"Now" stays the default, and the confirmation says what it means', () => {
  it('the form opens on Now', async () => {
    renderList();
    const dialog = await openBlockForm();
    expect(within(dialog).getByRole('radio', { name: 'Now' }).getAttribute('aria-checked')).toBe('true');
  });

  it('Now, unpaid fees: "starts now … charged now", and the button says now', async () => {
    renderList();
    const dialog = await openBlockForm();
    fireEvent.change(within(dialog).getByLabelText(/Amount each student owes/), { target: { value: '1500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const warning = await screen.findByTestId('bulk-now-warning');
    expect(warning.textContent).toBe('Starts now: these 2 students lose access to class immediately, and each is charged KES 1,500 now.');
    expect(screen.getByRole('button', { name: 'Block 2 students now' })).toBeTruthy();
  });

  it('Now, another reason: "starts now" without a charge', async () => {
    renderList();
    const dialog = await openBlockForm();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect((await screen.findByTestId('bulk-now-warning')).textContent).toBe('Starts now: these 2 students lose access to class immediately.');
  });

  it('Schedule: no "now" warning, and the button names the time', async () => {
    renderList();
    const dialog = await openBlockForm();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tomorrow 18:00' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: /^Schedule 2 blocks for \w{3} \d{1,2} \w{3}, 18:00$/ })).toBeTruthy();
    expect(screen.queryByTestId('bulk-now-warning')).toBeNull();
  });
});

describe('the toast\'s Undo works only on a double-click', () => {
  async function blockTwo() {
    api.runBulk.mockResolvedValue({ batchId: 'B1', done: 2, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 2 });
    api.undoBulk.mockResolvedValue({ undone: 2, changedSince: 0, missing: 0, failed: 0, status: 'undone' });
    renderList();
    const dialog = await openBlockForm();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Block 2 students now' })); });
    return screen.findByRole('button', { name: 'Undo' });
  }

  it('the toast says to double-click', async () => {
    await blockTwo();
    expect(screen.getByTestId('toast-action-hint').textContent).toBe('Double-click Undo to put these 2 students back.');
  });

  it('a single click does not undo; it highlights the prompt', async () => {
    const undo = await blockTwo();
    await act(async () => { fireEvent.click(undo, { detail: 1 }); });
    expect(api.undoBulk).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast-action-hint').className).toMatch(/is-nudged/);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy(); // the toast stays
  });

  it('a double-click undoes', async () => {
    const undo = await blockTwo();
    await act(async () => { fireEvent.click(undo, { detail: 1 }); fireEvent.click(undo, { detail: 2 }); });
    await waitFor(() => expect(api.undoBulk).toHaveBeenCalledWith('B1'));
    expect(api.undoBulk).toHaveBeenCalledTimes(1);
  });

  it('keyboard: two presses within a second undo; one does not', async () => {
    const undo = await blockTwo();
    await act(async () => { fireEvent.click(undo, { detail: 0 }); });
    expect(api.undoBulk).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(undo, { detail: 0 }); });
    await waitFor(() => expect(api.undoBulk).toHaveBeenCalledTimes(1));
  });

  it('two presses more than a second apart do not undo', async () => {
    const undo = await blockTwo();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await act(async () => { fireEvent.click(undo, { detail: 0 }); });
    now.mockReturnValue(1_002_500);
    await act(async () => { fireEvent.click(undo, { detail: 0 }); });
    now.mockRestore();
    expect(api.undoBulk).not.toHaveBeenCalled();
  });
});

describe('Recent actions says who undid an action, and when', () => {
  it('"Undone by <email> at HH:MM", or "by you"', async () => {
    const undoneAtMs = Date.parse('2026-10-30T19:55:07Z');
    api.listBulkActions.mockResolvedValue({ actions: [
      { id: 'B2', action: 'block', kind: 'fees', amount: 2750, status: 'undone', createdAtMs: Date.now(), undoUntilMs: Date.now() + 60_000, counts: { done: 144, undone: 144 }, createdBy: 'teacher.a@school.example', undoneBy: 'teacher.b@school.example', undoneAtMs },
      { id: 'B1', action: 'block', kind: 'other', status: 'undone', createdAtMs: Date.now() - 1000, undoUntilMs: Date.now() + 60_000, counts: { done: 2, undone: 2 }, createdBy: null, undoneBy: 'teacher.a@school.example', undoneAtMs },
    ] });
    const { default: RecentActionsPanel } = await import('@features/dashboard/components/bulk/RecentActionsPanel.jsx');
    render(<RecentActionsPanel onClose={vi.fn()} />);
    const items = await screen.findAllByTestId('recent-action');
    expect(items[0].textContent).toMatch(/Undone by teacher\.b@school\.example at 22:55/);
    expect(items[1].textContent).toMatch(/Undone by you at 22:55/);
  });
});
