import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 003Fixes / 05 — block and unblock a selection: the same form as the single
 * block, a confirmation that says who is skipped and why, progress, a toast
 * with Undo, and Recent actions (the obvious place to find Undo for 30 min).
 */

const api = vi.hoisted(() => {
  class BulkInterrupted extends Error {
    constructor(cause, partial) { super('dropped'); this.name = 'BulkInterrupted'; this.partial = partial; }
  }
  return {
    BulkInterrupted,
    DEFAULT_LIMITS: { block: 25, blockFees: 8, unblock: 25, approveReceipts: 8 },
    runBulk: vi.fn(),
    undoBulk: vi.fn(),
    listBulkActions: vi.fn(),
  };
});
vi.mock('@services/api/students', () => api);

const flags = vi.hoisted(() => ({ fees: true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => (k === 'fees.enabled' ? flags.fees : false) }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));

beforeEach(async () => {
  sessionStorage.clear();
  flags.fees = true;
  for (const fn of [api.runBulk, api.undoBulk, api.listBulkActions]) fn.mockReset();
  (await import('@features/dashboard/bulk/recentBulk')).__resetRecentBulk();
});
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const roster = [
  kid(1, 'Amina Wanjiru'),
  kid(2, 'Brian Otieno', { class: 'Grade 10' }),
  kid(3, 'Chebet Waiting', { approvalStatus: 'pending' }),
  kid(4, 'Dan Blocked', { blocked: true, blockReason: 'Earlier' }),
  kid(5, 'Esther Other'),
];
const sessionDoc = { id: 'morning', name: 'Morning Session', classes: ['Grade 10', 'Form 3'] };

function renderPanel() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel
          session="morning" sessionDoc={sessionDoc} students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
        />
      </MemoryRouter>
    </ToastProvider>
  );
}

const tick = (name) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
const bar = () => screen.findByRole('region', { name: 'Selected students' });
const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

const result = (over = {}) => ({ batchId: 'B1', done: 2, skipped: { awaitingApproval: 1, alreadyBlocked: 1 }, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 2, ...over });

describe('Block selected', () => {
  it('same form as the single block → confirmation with classes and skips → runs → toast with Undo; selection cleared', async () => {
    api.runBulk.mockImplementation(async ({ onProgress }) => { onProgress?.(2, 2); return result(); });
    renderPanel();
    for (const name of ['Amina Wanjiru', 'Brian Otieno', 'Chebet Waiting', 'Dan Blocked']) tick(name);
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));

    // The form: unpaid fees is the default with fees on and Silver+.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Unpaid fees/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(within(dialog).getByLabelText(/Amount each student owes/), { target: { value: '1500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    const confirm = await screen.findByTestId('bulk-confirm');
    // The bar steps aside while a dialog is open (on phones it would sit above it).
    expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull();
    expect(confirm.textContent).toMatch(/Form 3: 1 · Grade 10: 1|Grade 10: 1 · Form 3: 1/);
    expect(screen.getByTestId('bulk-skipped').textContent).toMatch(/2 will be skipped: 1 waiting for approval, 1 already blocked/);
    expect(confirm.textContent).toMatch(/Each will owe KES 1,500/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Block 2 students' })); });

    expect(api.runBulk).toHaveBeenCalledTimes(1);
    const args = api.runBulk.mock.calls[0][0];
    expect(args).toMatchObject({ action: 'block', kind: 'fees', amount: 1500 });
    expect(args.items).toEqual([{ session: 'morning', phone: roster[0].id }, { session: 'morning', phone: roster[1].id }]);

    const toast = await screen.findByText(/2 students blocked\. 2 skipped: 1 waiting for approval, 1 already blocked\./);
    expect(toast).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the toast\'s Undo undoes that batch', async () => {
    api.runBulk.mockResolvedValue(result());
    api.undoBulk.mockResolvedValue({ undone: 2, changedSince: 0, missing: 0, failed: 0, status: 'undone' });
    renderPanel();
    tick('Amina Wanjiru');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Block \d+ student/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Undo' })); });
    await waitFor(() => expect(api.undoBulk.mock.calls[0]?.[0]).toBe('B1'));
    expect(await screen.findByText(/2 students put back as they were/)).toBeTruthy();
  });

  it('fees off: the fee option is disabled and the reason is sent', async () => {
    flags.fees = false;
    api.runBulk.mockResolvedValue(result({ skipped: {} }));
    renderPanel();
    tick('Amina Wanjiru');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Unpaid fees/ }).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Fees for next week' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('bulk-confirm').textContent).toMatch(/They will see: “Fees for next week”/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Block 1 student' })); });
    expect(api.runBulk.mock.calls[0][0]).toMatchObject({ action: 'block', kind: 'other', reason: 'Fees for next week' });
  });

  it('a dropped connection: says what was done and Continue carries on the same action', async () => {
    const partial = { batchId: 'B7', next: 25, total: 40, result: { done: 25, skipped: {}, failed: [] } };
    api.runBulk.mockRejectedValueOnce(new api.BulkInterrupted(new Error('x'), partial)).mockResolvedValueOnce(result({ batchId: 'B7', done: 40, skipped: {} }));
    renderPanel();
    tick('Amina Wanjiru');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Block \d+ student/ })); });
    expect((await screen.findByTestId('bulk-interrupted')).textContent).toMatch(/after 25 of 40/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(api.runBulk.mock.calls[1][0].resume).toBe(partial);
  });

  it('a refusal on the first call (nothing done) shows the reason and keeps the confirmation open', async () => {
    api.runBulk.mockRejectedValue(Object.assign(new Error('This feature requires the silver plan.'), { status: 403 }));
    renderPanel();
    tick('Amina Wanjiru');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));
    fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText(/Amount each student owes|Amount owed/), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Block \d+ student/ })); });
    expect(await screen.findByText(/requires the silver plan/)).toBeTruthy();
    expect(screen.getByTestId('bulk-confirm')).toBeTruthy();
  });
});

describe('Unblock selected', () => {
  it('with the Blocked filter on: confirm, then unblock', async () => {
    api.runBulk.mockResolvedValue(result({ done: 1, skipped: {} }));
    renderPanel();
    fireEvent.click(statusChip('Blocked'));
    // Row boxes only (the header's is "Select all students on this page").
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(1));
    tick('Dan Blocked');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Unblock selected' }));
    expect(await screen.findByText('Unblock 1 student?')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unblock 1 student' })); });
    expect(api.runBulk.mock.calls[0][0]).toMatchObject({ action: 'unblock', items: [{ session: 'morning', phone: roster[3].id }] });
    expect(await screen.findByText(/1 student unblocked\./)).toBeTruthy();
  });
});

describe('Recent actions', () => {
  it('counts what can be undone, lists the server\'s actions, and undoes after a confirmation', async () => {
    api.runBulk.mockResolvedValue(result({ done: 2, skipped: {} }));
    api.listBulkActions.mockResolvedValue({ actions: [
      { id: 'B1', action: 'block', kind: 'fees', amount: 1500, status: 'done', createdAtMs: Date.now(), undoUntilMs: Date.now() + 24 * 60_000, counts: { done: 2 } },
      { id: 'B0', action: 'unblock', status: 'undone', createdAtMs: Date.now() - 600_000, undoUntilMs: Date.now() + 20 * 60_000, counts: { done: 3 } },
    ] });
    api.undoBulk.mockResolvedValue({ undone: 1, changedSince: 1, missing: 0, failed: 0, status: 'undone' });
    renderPanel();
    const button = () => screen.getByRole('button', { name: /Recent actions/ });
    expect(button().textContent).not.toMatch(/\d/);

    tick('Amina Wanjiru');
    fireEvent.click(within(await bar()).getByRole('button', { name: 'Block selected' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('radio', { name: /Another reason/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /^Block \d+ student/ })); });
    await waitFor(() => expect(button().textContent).toMatch(/1/));

    fireEvent.click(button());
    const items = await screen.findAllByTestId('recent-action');
    expect(items[0].textContent).toMatch(/Blocked 2 students · unpaid fees KES 1,500/);
    expect(items[0].textContent).toMatch(/24 min left to undo/);
    expect(items[1].textContent).toMatch(/undone/);
    expect(within(items[1]).queryByRole('button', { name: /Undo/ })).toBeNull();

    fireEvent.click(within(items[0]).getByRole('button', { name: /Undo/ }));
    expect(within(items[0]).getByText(/Put these 2 students back as they were\?/)).toBeTruthy();
    await act(async () => { fireEvent.click(within(items[0]).getByRole('button', { name: 'Yes, undo' })); });
    expect(api.undoBulk.mock.calls[0][0]).toBe('B1');
    expect(await screen.findByText(/1 student put back as they were\. 1 had changed since/)).toBeTruthy();
  });
});
