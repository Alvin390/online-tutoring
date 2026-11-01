import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';
import { describeResult } from '@features/dashboard/bulk/bulkText';

/**
 * 004Fixes / 03 — the dashboard side of "every staff account sees everything":
 * each schedule and recent action says who made it, and cancelling a schedule
 * from a row never claims success when the server removed nobody.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25 },
  runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(), listBulkItems: vi.fn(),
  runSchedule: vi.fn(), removeFromSchedule: vi.fn(), listSchedules: vi.fn(), rescheduleSchedule: vi.fn(), cancelSchedule: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false, user: { uid: 'b', email: 'teacher.b@school.example' } }),
}));

beforeEach(() => {
  sessionStorage.clear();
  for (const fn of Object.values(api)) if (fn?.mockReset) fn.mockReset();
});
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const SOON = Date.now() + 17 * 3_600_000;
const kid = (n, over = {}) => ({
  id: `+2547110000${n}`, parentPhone: `+2547110000${n}`, studentName: `Student ${n}`, class: 'Form 3', subjects: 'English',
  receiptMessage: `R${n}ABCDEFGH ok`, receiptStatus: 'approved', approvalStatus: 'approved', blocked: false, feeBalance: 0,
  registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000),
  scheduledBlock: { atMs: SOON, batchId: 'S1', kind: 'fees', reason: null },
  ...over,
});
const roster = [kid(1), kid(2), kid(3)];

function renderList() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel session="evening" sessionDoc={{ id: 'evening', name: 'Evening', classes: ['Form 3'] }} students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </MemoryRouter>
    </ToastProvider>
  );
}
const schedule = (over = {}) => ({ id: 'S1', atMs: SOON, kind: 'fees', amount: 2750, reason: null, count: 3, createdBy: 'teacher.a@school.example', ...over });

describe('the Scheduled popup says who made each schedule', () => {
  it('another account\'s schedule is listed with its email, and can be changed', async () => {
    api.listSchedules.mockResolvedValue({ schedules: [schedule()] });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled blocks (1)' }));
    const item = (await screen.findAllByTestId('scheduled-item'))[0];
    expect(item.textContent).toMatch(/by teacher\.a@school\.example/);
    expect(within(item).getByRole('button', { name: 'Reschedule' })).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('"by you" for the signed-in account; "by another staff account" for older schedules', async () => {
    api.listSchedules.mockResolvedValue({ schedules: [
      schedule({ createdBy: 'teacher.b@school.example' }),
      schedule({ id: 'S2', createdBy: null, atMs: SOON + 3_600_000 }),
    ] });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: /Scheduled blocks/ }));
    const items = await screen.findAllByTestId('scheduled-item');
    expect(items[0].textContent).toMatch(/by you/);
    expect(items[1].textContent).toMatch(/by another staff account/);
  });

  it('when the students show a schedule the list does not have yet, it says so instead of "Nothing scheduled"', async () => {
    api.listSchedules.mockResolvedValue({ schedules: [] });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled blocks (1)' }));
    expect(await screen.findByTestId('scheduled-catching-up')).toHaveTextContent(/being applied/);
    expect(screen.queryByTestId('scheduled-empty')).toBeNull();
  });
});

describe('the × on a row\'s "Block scheduled" tag tells the truth', () => {
  const pressX = async () => {
    const row = [...document.querySelectorAll('tr.student-row-wrapper')][0];
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: /Cancel the scheduled block for/ })); });
    await act(async () => {});
  };

  it('removed: "will not be blocked"', async () => {
    api.removeFromSchedule.mockResolvedValue({ done: 1, skipped: {}, total: 1, failed: [] });
    renderList();
    await pressX();
    expect(await screen.findByText(/will not be blocked/)).toBeTruthy();
  });

  it('nothing removed: a warning that the student is no longer scheduled, never "will not be blocked"', async () => {
    api.removeFromSchedule.mockResolvedValue({ done: 0, skipped: { notScheduled: 1 }, total: 1, failed: [] });
    renderList();
    await pressX();
    expect(await screen.findByText(/is no longer scheduled/)).toBeTruthy();
    expect(screen.queryByText(/will not be blocked/)).toBeNull();
  });
});

describe('Recent actions say who did each one', () => {
  it('another account\'s action shows its email and can be undone', async () => {
    api.listBulkActions.mockResolvedValue({ actions: [
      { id: 'B1', action: 'block', kind: 'fees', amount: 2750, status: 'done', createdAtMs: Date.now(), undoUntilMs: Date.now() + 20 * 60_000, counts: { done: 3 }, createdBy: 'teacher.a@school.example' },
      { id: 'B0', action: 'unblock', status: 'done', createdAtMs: Date.now() - 60_000, undoUntilMs: Date.now() + 19 * 60_000, counts: { done: 1 }, createdBy: null },
    ] });
    const { default: RecentActionsPanel } = await import('@features/dashboard/components/bulk/RecentActionsPanel.jsx');
    render(<RecentActionsPanel onClose={vi.fn()} />);
    const items = await screen.findAllByTestId('recent-action');
    expect(items[0].textContent).toMatch(/by teacher\.a@school\.example/);
    expect(within(items[0]).getByRole('button', { name: /Undo/ })).toBeTruthy();
    expect(items[1].textContent).toMatch(/by another staff account/);
  });
});

describe('bulk "Cancel schedule" wording', () => {
  it('students whose schedule had already gone read "no longer scheduled"', () => {
    expect(describeResult('cancelSchedule', { done: 1, skipped: { notScheduled: 2 }, failed: [] }))
      .toBe('1 student taken out of their scheduled block. 2 skipped: 2 no longer scheduled.');
  });
});
