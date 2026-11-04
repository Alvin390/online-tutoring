import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';
import { rememberBulk, __resetRecentBulk } from '@features/dashboard/bulk/recentBulk';

/**
 * 006Fixes / 02 — bulk delete on the dashboard (owner, 4 Nov 2026): a Delete
 * button next to the selection bar's action, a confirmation that names who
 * and what they owe, enabled only once DELETE is typed, and no Undo.
 */

const api = vi.hoisted(() => {
  class BulkInterrupted extends Error {}
  return {
    BulkInterrupted,
    DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25, delete: 12 },
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
  __resetRecentBulk();
  for (const fn of Object.values(api)) if (fn?.mockReset) fn.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, extra = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...extra,
});
const NAMES = ['Amina Wanjiru', 'Brian Otieno', 'Chebet Kiprop', 'Dennis Mwangi', 'Esther Achieng', 'Faith Njeri', 'Grace Wambui'];
const roster = NAMES.map((name, i) => kid(i + 1, name, i < 2 ? { feeBalance: 2750 + i * 1000 } : {}));

function renderList(students = roster) {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'], schedule: { days: [], tz: 'Africa/Nairobi', startTime: '08:30', endTime: '10:30' } }}
          students={students} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </MemoryRouter>
    </ToastProvider>
  );
}

const tick = (names) => { for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` })); };
const bar = () => screen.findByRole('region', { name: 'Selected students' });
async function openDelete(names) {
  tick(names);
  fireEvent.click(within(await bar()).getByRole('button', { name: 'Delete' }));
  return screen.findByRole('dialog');
}

describe('the Delete button sits next to the selection bar\'s action', () => {
  it('shows beside Block selected and opens the delete confirmation', async () => {
    renderList();
    tick(['Amina Wanjiru']);
    const region = await bar();
    expect(within(region).getByRole('button', { name: 'Block selected' })).toBeTruthy();
    const del = within(region).getByRole('button', { name: 'Delete' });
    expect(del.className).toMatch(/btn-outline-danger/);
    fireEvent.click(del);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete 1 student?')).toBeTruthy();
  });
});

describe('the confirmation', () => {
  it('names the first five, then "and N more", and the money owed', async () => {
    renderList();
    const dialog = await openDelete(NAMES);
    expect(within(dialog).getByText('Delete 7 students?')).toBeTruthy();
    const who = within(dialog).getByTestId('bulk-delete-who');
    for (const name of NAMES.slice(0, 5)) expect(who.textContent).toContain(name);
    expect(who.textContent).not.toContain('Faith Njeri');
    expect(who.textContent).toContain('and 2 more');
    expect(within(dialog).getByTestId('bulk-delete-money').textContent)
      .toBe('2 of them owe KES 6,500. Deleting closes these balances, and they no longer count in Total outstanding.');
    expect(within(dialog).getByTestId('bulk-delete-warning').textContent).toMatch(/can't be undone/i);
  });

  it('has no money line when nobody owes', async () => {
    renderList();
    const dialog = await openDelete(['Chebet Kiprop', 'Dennis Mwangi']);
    expect(within(dialog).queryByTestId('bulk-delete-money')).toBeNull();
  });

  it('the Delete button stays disabled until DELETE is typed exactly (spaces trimmed)', async () => {
    renderList();
    const dialog = await openDelete(['Chebet Kiprop', 'Dennis Mwangi']);
    const button = within(dialog).getByRole('button', { name: 'Delete 2 students' });
    const input = within(dialog).getByLabelText(/Type DELETE to confirm/);
    for (const value of ['', 'delete', 'DELET', 'Delete', 'DELETE!']) {
      fireEvent.change(input, { target: { value } });
      expect(button.disabled, value).toBe(true);
    }
    for (const value of ['DELETE', '  DELETE ']) {
      fireEvent.change(input, { target: { value } });
      expect(button.disabled, value).toBe(false);
    }
    expect(api.runBulk).not.toHaveBeenCalled();
  });

  it('Cancel closes it without deleting anything', async () => {
    renderList();
    const dialog = await openDelete(['Chebet Kiprop']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.runBulk).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  it('sends action delete with the confirmation, then a toast with no Undo', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'D1', done: 2, skipped: {}, failed: [], total: 2, balanceClosedTotal: 2750, balanceClosedCount: 1 });
    renderList();
    const dialog = await openDelete(['Amina Wanjiru', 'Chebet Kiprop']);
    fireEvent.change(within(dialog).getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 students' }));
    await waitFor(() => expect(api.runBulk).toHaveBeenCalledTimes(1));
    expect(api.runBulk.mock.calls[0][0]).toMatchObject({
      action: 'delete',
      items: [{ session: 'morning', phone: roster[0].id }, { session: 'morning', phone: roster[2].id }],
    });
    const toast = await screen.findByText(/2 students deleted\./);
    const box = toast.closest('[role="alert"], [role="status"], .toast') ?? toast.parentElement;
    expect(within(box).queryByRole('button', { name: 'Undo' })).toBeNull();
    // Not counted as something that can be undone.
    expect(screen.getByRole('button', { name: 'Recent actions' })).toBeTruthy();
  });
});

describe('Recent actions', () => {
  it('lists a delete with no Undo, saying it can\'t be undone', async () => {
    api.listBulkActions.mockResolvedValue({
      actions: [{
        id: 'D1', action: 'delete', status: 'done', undoable: false, createdAtMs: Date.now() - 60_000,
        undoUntilMs: Date.now() + 29 * 60_000, counts: { done: 12 }, createdBy: 'teacher.a@school.example',
      }],
    });
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Recent actions' }));
    const item = await screen.findByTestId('recent-action');
    expect(item.textContent).toContain('Deleted 12 students');
    expect(item.textContent).toContain("Can't be undone");
    expect(within(item).queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('the badge does not count a delete as undoable', async () => {
    rememberBulk({ id: 'D1', action: 'delete', status: 'done', undoable: false, createdAtMs: Date.now(), undoUntilMs: Date.now() + 30 * 60_000, counts: { done: 3 } });
    renderList();
    expect(screen.getByRole('button', { name: 'Recent actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /can be undone/ })).toBeNull();
  });
});
