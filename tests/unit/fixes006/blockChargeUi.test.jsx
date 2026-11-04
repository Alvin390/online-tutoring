import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 006Fixes / 09 — blocking someone who already owes (owner, 4 Nov 2026):
 * "Block for what they owe" (the default, no new charge) or "Add a new
 * charge of KES X". Bulk (now and scheduled) and the single block.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25, delete: 12 },
  runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(), runSchedule: vi.fn(),
  listSchedules: vi.fn(), rescheduleSchedule: vi.fn(), cancelSchedule: vi.fn(), removeFromSchedule: vi.fn(),
}));
const fees = vi.hoisted(() => ({ postLedgerEntry: vi.fn() }));
vi.mock('@services/api/students', () => api);
vi.mock('@services/api/fees', () => fees);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => k === 'fees.enabled' }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false, user: { email: 't@school.example' } }) }));

beforeEach(async () => {
  sessionStorage.clear();
  for (const fn of [...Object.values(api), ...Object.values(fees)]) if (fn?.mockReset) fn.mockReset();
  (await import('@features/dashboard/bulk/recentBulk')).__resetRecentBulk();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const roster = [
  kid(1, 'Claire Job', { feeBalance: 1550, partialPayment: { paid: 1200, owedBefore: 2750, owedAfter: 1550 } }),
  kid(2, 'Sheila Wanjiru', { feeBalance: 1250, partialPayment: { paid: 1500, owedBefore: 2750, owedAfter: 1250 } }),
  kid(3, 'Esther Clear'),
];
const SCHEDULE = { days: [], tz: 'Africa/Nairobi', startTime: '18:30', endTime: '20:30' };

function renderPanel(students = roster) {
  const onBlock = vi.fn().mockResolvedValue({ success: true });
  const noop = vi.fn();
  render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel session="evening" sessionDoc={{ id: 'evening', name: 'Evening', classes: ['Form 3'], schedule: SCHEDULE }}
          students={students} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={onBlock} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </MemoryRouter>
    </ToastProvider>
  );
  return { onBlock };
}
async function openBulkBlock(names) {
  for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
  fireEvent.click(within(await screen.findByRole('region', { name: 'Selected students' })).getByRole('button', { name: 'Block selected' }));
  return screen.findByRole('dialog');
}

describe('bulk block when some selected already owe', () => {
  it('offers "Block for what they owe" (default) with the totals, and who will be skipped', async () => {
    renderPanel();
    const dialog = await openBulkBlock(['Claire Job', 'Sheila Wanjiru', 'Esther Clear']);
    const owe = within(dialog).getByRole('radio', { name: /Block for what they owe/ });
    expect(owe.getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByRole('radio', { name: /Add a new charge/ }).getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getByTestId('block-owe-summary').textContent)
      .toBe('No new charge. 2 students owe KES 2,800 in total. 1 of them owes nothing and will be skipped.');
    expect(within(dialog).queryByLabelText(/Amount each student owes/)).toBeNull();
  });

  it('"for what they owe" sends charge: false with no amount; the confirmation says no new charge', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'B1', done: 2, skipped: { nothingOwed: 1 }, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 3 });
    renderPanel();
    const dialog = await openBulkBlock(['Claire Job', 'Sheila Wanjiru', 'Esther Clear']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByTestId('bulk-confirm');
    expect(within(confirm).getByTestId('bulk-now-warning').textContent)
      .toBe('Starts now: these 2 students lose access to class immediately (no new charge).');
    expect(confirm.textContent).toMatch(/1 owing nothing/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Block 2 students now' })); });
    const call = api.runBulk.mock.calls[0][0];
    expect(call).toMatchObject({ action: 'block', kind: 'fees', charge: false });
    expect(call.amount).toBeUndefined();
    expect(call.items.map((i) => i.phone)).toEqual([roster[0].id, roster[1].id]);
    expect(await screen.findByText(/1 skipped: 1 owing nothing\./)).toBeTruthy();
  });

  it('"Add a new charge" needs an amount and sends charge: true', async () => {
    api.runBulk.mockResolvedValue({ batchId: 'B2', done: 3, skipped: {}, failed: [], undoUntilMs: Date.now() + 1_800_000, total: 3 });
    renderPanel();
    const dialog = await openBulkBlock(['Claire Job', 'Sheila Wanjiru', 'Esther Clear']);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Add a new charge/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Enter the amount owed, in whole shillings.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Amount each student owes/), { target: { value: '2750' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByTestId('bulk-confirm');
    expect(within(confirm).getByTestId('bulk-now-warning').textContent).toMatch(/each is charged KES 2,750 now/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Block 3 students now' })); });
    expect(api.runBulk.mock.calls[0][0]).toMatchObject({ kind: 'fees', charge: true, amount: 2750 });
  });

  it('a scheduled block "for what they owe" sends charge: false to the schedule', async () => {
    api.runSchedule.mockResolvedValue({ batchId: 'S1', added: 2, skipped: {}, atMs: Date.now() + 86_400_000, total: 2 });
    renderPanel();
    const dialog = await openBulkBlock(['Claire Job', 'Sheila Wanjiru']);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^Tomorrow/.test(b.textContent)) ?? within(dialog).getAllByRole('button', { name: /\d/ })[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('bulk-confirm');
    await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => /^Schedule 2 blocks/.test(b.textContent))); });
    const call = api.runSchedule.mock.calls[0][0];
    expect(call).toMatchObject({ kind: 'fees', charge: false });
    expect(call.amount).toBeUndefined();
  });
});

describe('when nobody selected owes', () => {
  it('the form is unchanged: a new charge with an amount', async () => {
    renderPanel([kid(3, 'Esther Clear'), kid(4, 'Faith Clear')]);
    const dialog = await openBulkBlock(['Esther Clear', 'Faith Clear']);
    expect(within(dialog).queryByRole('radio', { name: /Block for what they owe/ })).toBeNull();
    expect(within(dialog).getByLabelText(/Amount each student owes/)).toBeTruthy();
  });
});

describe('the single block', () => {
  it('for someone who owes: "for what they owe" blocks without posting a charge', async () => {
    const { onBlock } = renderPanel();
    const row = screen.getAllByRole('row').find((r) => r.textContent.includes('Claire Job'));
    fireEvent.click(within(row).getByTitle('Block student'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Block for what they owe/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(dialog).getByTestId('block-owe-summary').textContent).toBe('No new charge. Owes KES 1,550.');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })); });
    expect(fees.postLedgerEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(onBlock).toHaveBeenCalledWith('evening', roster[0].id, 'Claire Job', ''));
  });
});

describe('the Scheduled panel', () => {
  it('says whether a schedule charges or blocks for what they owe', async () => {
    api.listSchedules.mockResolvedValue({
      schedules: [
        { id: 'S1', atMs: Date.now() + 86_400_000, kind: 'fees', charge: false, amount: null, count: 2, createdBy: 't@school.example' },
        { id: 'S2', atMs: Date.now() + 2 * 86_400_000, kind: 'fees', charge: true, amount: 2750, count: 1, createdBy: 't@school.example' },
      ],
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Scheduled blocks/ }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toMatch(/for what they owe/));
    expect(screen.getByRole('dialog').textContent).toMatch(/unpaid fees KES 2,750/);
  });
});
