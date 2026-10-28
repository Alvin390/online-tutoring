import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 003Fixes / 06 — "Approve receipts" for a selection: the confirmation says
 * who owes (their balance is recorded as paid, with their M-Pesa code) and who
 * owes nothing, then the same progress, toast and Undo as a bulk block.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 8, unblock: 25, approveReceipts: 8 },
  runBulk: vi.fn(),
  undoBulk: vi.fn(),
  listBulkActions: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));

beforeEach(async () => {
  sessionStorage.clear();
  api.runBulk.mockReset();
  (await import('@features/dashboard/bulk/recentBulk')).__resetRecentBulk();
});
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'OLD Confirmed', receiptStatus: 'expired',
  approvalStatus: 'approved', blocked: true, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const roster = [
  kid(1, 'Amina Owes', { feeBalance: 1500, pendingReceipt: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending' }),
  kid(2, 'Brian Owes', { feeBalance: 1500, pendingReceipt: 'QAB124XYZ9 Confirmed', receiptStatus: 'pending' }),
  kid(3, 'Chebet Clear', { pendingReceipt: 'QAB125XYZ9 Confirmed', receiptStatus: 'pending' }),
  kid(4, 'Dan NoReceipt'),
];

function renderPanel() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel
          session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }} students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
        />
      </MemoryRouter>
    </ToastProvider>
  );
}

const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

describe('Approve receipts', () => {
  it('confirms who owes and who does not, approves exactly those with a receipt, then a toast with Undo', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'A1', done: 3, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 3 });
    renderPanel();
    fireEvent.click(statusChip('Receipt to review'));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(3));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all students on this page' }));
    const bar = await screen.findByRole('region', { name: 'Selected students' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Approve receipts' }));

    expect(await screen.findByText('Approve 3 students?')).toBeTruthy();
    const confirm = screen.getByTestId('bulk-confirm').textContent;
    expect(confirm).toMatch(/2 owe a balance: each balance is recorded as paid, with the M-Pesa code from their receipt/);
    expect(confirm).toMatch(/1 owes nothing: they are let back in/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve 3 students' })); });

    expect(api.runBulk.mock.calls[0][0]).toMatchObject({ action: 'approveReceipts' });
    expect(api.runBulk.mock.calls[0][0].items.map((i) => i.phone)).toEqual(roster.slice(0, 3).map((s) => s.id));
    expect(await screen.findByText(/3 students approved\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('with both Blocked and Receipt to review on, the action is still Approve receipts', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'A2', done: 1, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 1 });
    renderPanel();
    // Receipt to review AND Blocked on: the action is still Approve receipts.
    fireEvent.click(statusChip('Blocked'));
    fireEvent.click(statusChip('Receipt to review'));
    // Status chips combine with OR: all four are blocked.
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(4));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Chebet Clear' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Selected students' })).getByRole('button', { name: 'Approve receipts' }));
    expect(await screen.findByText('Approve 1 student?')).toBeTruthy();
  });
});
