import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 006Fixes / 07 — bulk "Approve receipts" asks Complete or Partial (owner,
 * 4 Nov 2026). Partial lists the students who owe, each with an amount box
 * (prefilled from their receipt), and approves the valid ones.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25, delete: 12 },
  runBulk: vi.fn(),
  undoBulk: vi.fn(),
  listBulkActions: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false, user: { email: 't@school.example' } }) }));

beforeEach(async () => {
  sessionStorage.clear();
  api.runBulk.mockReset();
  api.listBulkActions.mockReset();
  (await import('@features/dashboard/bulk/recentBulk')).__resetRecentBulk();
});
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'OLD Confirmed', receiptStatus: 'pending',
  approvalStatus: 'approved', blocked: true, feeBalance: 2750, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const roster = [
  kid(1, 'Claire Job', { pendingReceipt: 'UK2PK0FF1R Confirmed. Ksh1,200.00 paid to FOCUS ONLINE' }),
  kid(2, 'Sheila Wanjiru', { pendingReceipt: 'UK2J10W8SZ Confirmed. Ksh1,500.00 paid' }),
  kid(3, 'Faiza Farid', { pendingReceipt: 'UK2LD04OM8' }),
  kid(4, 'Dan Clear', { pendingReceipt: 'QAB125XYZ9 Confirmed', feeBalance: 0 }),
];

function renderPanel() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel
          session="evening" sessionDoc={{ id: 'evening', name: 'Evening', classes: ['Form 3'] }} students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
        />
      </MemoryRouter>
    </ToastProvider>
  );
}
const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

async function openApprove() {
  renderPanel();
  fireEvent.click(statusChip('Receipt to review'));
  await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(4));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all students on this page' }));
  const bar = await screen.findByRole('region', { name: 'Selected students' });
  fireEvent.click(within(bar).getByRole('button', { name: 'Approve receipts' }));
  return screen.findByRole('dialog');
}

describe('the choice', () => {
  it('offers Complete (the default, as before) and Partial', async () => {
    const dialog = await openApprove();
    const complete = within(dialog).getByRole('radio', { name: /Complete payment for all/ });
    expect(complete.checked).toBe(true);
    expect(within(dialog).getByRole('radio', { name: /Partial payment/ })).toBeTruthy();
    expect(within(dialog).getByTestId('bulk-approve-complete').textContent)
      .toBe("Records each student's full balance as paid (KES 8,250 for 3 students).");
  });

  it('Complete sends payment: full with no amounts', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'A1', done: 4, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 4 });
    const dialog = await openApprove();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 4 students' })); });
    const call = api.runBulk.mock.calls[0][0];
    expect(call).toMatchObject({ action: 'approveReceipts', payment: 'full' });
    expect(call.items.every((i) => i.amount === undefined)).toBe(true);
  });
});

describe('partial', () => {
  it('lists those who owe with what they owe, prefilled from each receipt', async () => {
    const dialog = await openApprove();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    const lines = within(dialog).getAllByTestId('partial-line');
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toContain('Claire Job');
    expect(lines[0].textContent).toContain('owes KES 2,750');
    expect(within(lines[0]).getByLabelText('Amount paid by Claire Job').value).toBe('1200');
    expect(within(lines[1]).getByLabelText('Amount paid by Sheila Wanjiru').value).toBe('1500');
    expect(within(lines[2]).getByLabelText('Amount paid by Faiza Farid').value).toBe('');
    expect(lines[0].textContent).toContain('owes KES 1,550 after');
    expect(within(dialog).getByTestId('partial-not-owing').textContent).toBe('1 owes nothing and is not included: approve them with Complete payment.');
  });

  it('counts only valid lines, says how many need an amount, and totals the money', async () => {
    const dialog = await openApprove();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    expect(within(dialog).getByTestId('partial-needs').textContent).toBe('1 needs an amount.');
    expect(within(dialog).getByTestId('partial-total').textContent).toBe('Records KES 2,700 paid across 2 students. KES 2,800 stays owing.');
    expect(within(dialog).getByRole('button', { name: 'Approve 2 (partial)' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Amount paid by Faiza Farid'), { target: { value: '2750' } });
    expect(within(dialog).getAllByTestId('partial-line')[2].className).toMatch(/is-invalid|partial-invalid/);
    fireEvent.change(within(dialog).getByLabelText('Amount paid by Faiza Farid'), { target: { value: '1000' } });
    expect(within(dialog).queryByTestId('partial-needs')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Approve 3 (partial)' })).toBeTruthy();
  });

  it('"Use the same amount for all" fills every box', async () => {
    const dialog = await openApprove();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    fireEvent.change(within(dialog).getByLabelText('Same amount for all'), { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use for all' }));
    for (const name of ['Claire Job', 'Sheila Wanjiru', 'Faiza Farid']) {
      expect(within(dialog).getByLabelText(`Amount paid by ${name}`).value).toBe('1000');
    }
  });

  it('sends payment: partial with each valid amount; the toast says partial and keeps the double-click Undo', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'P1', done: 2, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 2 });
    const dialog = await openApprove();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Partial payment/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 2 (partial)' })); });
    const call = api.runBulk.mock.calls[0][0];
    expect(call).toMatchObject({ action: 'approveReceipts', payment: 'partial' });
    expect(call.items).toEqual([
      { session: 'evening', phone: roster[0].id, amount: 1200 },
      { session: 'evening', phone: roster[1].id, amount: 1500 },
    ]);
    expect(await screen.findByText(/2 students approved \(partial payment\)\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('Recent actions', () => {
  it('says the approval was partial', async () => {
    api.listBulkActions.mockResolvedValue({
      actions: [{ id: 'P1', action: 'approveReceipts', payment: 'partial', status: 'done', createdAtMs: Date.now() - 60_000, undoUntilMs: Date.now() + 29 * 60_000, counts: { done: 4 }, createdBy: 't@school.example' }],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Recent actions/ }));
    const item = await screen.findByTestId('recent-action');
    expect(item.textContent).toContain('Approved 4 students · partial payment');
  });
});
