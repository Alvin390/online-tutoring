import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';
import { toInputs, fromInputs } from '@features/dashboard/bulk/scheduleTime';
import { nairobiParts, fromNairobi } from '@utils/dates';

/**
 * 003Fixes / 08 — Now / Schedule in both block forms, the row tag with Cancel,
 * the "Block scheduled" filter with "Cancel schedule", and the Scheduled panel
 * (batches and individuals: reschedule, cancel, take one student out).
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25 },
  runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(),
  runSchedule: vi.fn(), removeFromSchedule: vi.fn(), listSchedules: vi.fn(), rescheduleSchedule: vi.fn(), cancelSchedule: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));

beforeEach(async () => {
  sessionStorage.clear();
  for (const fn of Object.values(api)) if (fn?.mockReset) fn.mockReset();
  (await import('@features/dashboard/bulk/recentBulk')).__resetRecentBulk();
});
afterEach(() => cleanup());

const tomorrow18 = () => {
  const p = nairobiParts(new Date());
  return fromNairobi({ year: p.year, month: p.month, day: p.day + 1, hours: 18, minutes: 0 }).getTime();
};
const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const kid = (n, name, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`, studentName: name, parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: 'Form 3', subjects: 'English', receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'approved',
  approvalStatus: 'approved', blocked: false, feeBalance: 0, registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
});
const SOON = Date.now() + 3 * 86_400_000;
const roster = [
  kid(1, 'Amina Wanjiru'),
  kid(2, 'Brian Otieno'),
  kid(3, 'Chebet Scheduled', { scheduledBlock: { atMs: SOON, batchId: 'S1', kind: 'other', reason: 'Fee due' } }),
  kid(4, 'Dan Scheduled', { scheduledBlock: { atMs: SOON, batchId: 'S1', kind: 'other', reason: 'Fee due' } }),
  kid(5, 'Esther Alone', { scheduledBlock: { atMs: SOON + 3_600_000, batchId: 'S2', kind: 'other', reason: '' } }),
];

function renderPanel() {
  const noop = vi.fn();
  return render(
    <ToastProvider>
      <MemoryRouter>
        <StudentSearchPanel
          session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'], schedule: { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' } }}
          students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
        />
      </MemoryRouter>
    </ToastProvider>
  );
}
const row = (name) => [...document.querySelectorAll('tr.student-row-wrapper')].find((tr) => tr.textContent.includes(name));
const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

describe('single student: Schedule', () => {
  it('pick "Tomorrow 18:00" → Schedule block → scheduled for that Nairobi time, with the reason; a toast says when', async () => {
    api.runSchedule.mockResolvedValue({ batchId: 'S9', added: 1, skipped: {}, atMs: tomorrow18() });
    renderPanel();
    fireEvent.click(within(row('Amina Wanjiru')).getByTitle('Block student'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tomorrow 18:00' }));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Fee due' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule block' })); });
    expect(api.runSchedule).toHaveBeenCalledWith(expect.objectContaining({
      items: [{ session: 'morning', phone: roster[0].id }], atMs: tomorrow18(), kind: 'other', reason: 'Fee due',
    }));
    expect(await screen.findByText(/Amina Wanjiru will be blocked from .* 18:00/)).toBeTruthy();
  });

  it('a time in the past is refused in the form', async () => {
    renderPanel();
    fireEvent.click(within(row('Amina Wanjiru')).getByTitle('Block student'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2020-01-01' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Schedule block' })); });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/at least 5 minutes from now/);
    expect(api.runSchedule).not.toHaveBeenCalled();
  });

  it('Now still blocks at once, exactly as before', async () => {
    const onBlock = vi.fn().mockResolvedValue({ success: true });
    const noop = vi.fn();
    render(<ToastProvider><MemoryRouter><StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }} students={roster} loading={false}
      onDelete={noop} onEdit={noop} onExport={noop} onBlock={onBlock} onUnblock={noop} onApprove={noop} onDecline={noop} /></MemoryRouter></ToastProvider>);
    fireEvent.click(within(row('Amina Wanjiru')).getByTitle('Block student'));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' })); });
    expect(onBlock).toHaveBeenCalledWith('morning', roster[0].id, 'Amina Wanjiru', '');
    expect(api.runSchedule).not.toHaveBeenCalled();
  });
});

describe('a selection: Schedule', () => {
  it('the confirmation names the time, takes everyone selected, and the toast points to Scheduled', async () => {
    api.runSchedule.mockImplementation(async ({ items, atMs }) => ({ batchId: 'S7', added: items.length, skipped: {}, atMs, total: items.length }));
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Amina Wanjiru' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Brian Otieno' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Selected students' })).getByRole('button', { name: 'Block selected' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tomorrow 18:00' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Block 2 students from .* 18:00\?/)).toBeTruthy();
    expect(screen.getByTestId('bulk-scheduled-note').textContent).toMatch(/anyone who pays before then is taken out/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 blocks' })); });
    expect(api.runSchedule.mock.calls[0][0]).toMatchObject({ atMs: tomorrow18(), kind: 'other' });
    expect(api.runSchedule.mock.calls[0][0].items).toHaveLength(2);
    expect(await screen.findByText(/2 students will be blocked from .*Change or cancel it under Scheduled/)).toBeTruthy();
    expect(api.runBulk).not.toHaveBeenCalled();
  });
});

describe('the row tag and the "Block scheduled" filter', () => {
  it('a scheduled student shows the tag; its × takes them out', async () => {
    api.removeFromSchedule.mockResolvedValue({ done: 1, skipped: {}, total: 1 });
    renderPanel();
    expect(within(row('Chebet Scheduled')).getByTestId('schedule-tag').textContent).toMatch(/Block scheduled · \w{3} \d{2}:\d{2}/);
    expect(within(row('Amina Wanjiru')).queryByTestId('schedule-tag')).toBeNull();
    await act(async () => { fireEvent.click(within(row('Chebet Scheduled')).getByRole('button', { name: 'Cancel the scheduled block for Chebet Scheduled' })); });
    expect(api.removeFromSchedule).toHaveBeenCalledWith([{ session: 'morning', phone: roster[2].id }]);
    expect(await screen.findByText(/Chebet Scheduled will not be blocked/)).toBeTruthy();
  });

  it('the chip counts them; with it on, the bar offers Cancel schedule', async () => {
    api.removeFromSchedule.mockResolvedValue({ done: 3, skipped: {}, total: 3, failed: [] });
    renderPanel();
    expect(statusChip('Block scheduled').textContent).toMatch(/3/);
    fireEvent.click(statusChip('Block scheduled'));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^Select (?!all )/ })).toHaveLength(3));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all students on this page' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Selected students' })).getByRole('button', { name: 'Cancel schedule' }));
    expect(await screen.findByText('Cancel the scheduled block for 3 students?')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel the scheduled block for 3 students' })); });
    expect(api.removeFromSchedule.mock.calls[0][0]).toHaveLength(3);
    expect(await screen.findByText(/3 students taken out of their scheduled block/)).toBeTruthy();
  });
});

describe('the Scheduled panel', () => {
  const schedules = [
    { id: 'S1', atMs: SOON, kind: 'other', reason: 'Fee due', amount: null, count: 2 },
    { id: 'S2', atMs: SOON + 3_600_000, kind: 'fees', reason: null, amount: 1500, count: 1 },
  ];

  it('the button counts schedules; the panel shows a batch and an individual, by name', async () => {
    api.listSchedules.mockResolvedValue({ schedules });
    renderPanel();
    const button = screen.getByRole('button', { name: /Scheduled blocks/ });
    expect(button.textContent).toMatch(/2/);
    fireEvent.click(button);
    const items = await screen.findAllByTestId('scheduled-item');
    expect(items[0].textContent).toMatch(/2 students · “Fee due”/);
    expect(items[1].textContent).toMatch(/Esther Alone · unpaid fees KES 1,500/);
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Show students' }));
    const names = within(items[0]).getByTestId('scheduled-members').textContent;
    expect(names).toMatch(/Chebet Scheduled/);
    expect(names).toMatch(/Dan Scheduled/);
  });

  it('reschedule, cancel, and take one student out', async () => {
    api.listSchedules.mockResolvedValue({ schedules });
    api.rescheduleSchedule.mockResolvedValue({ ok: true });
    api.cancelSchedule.mockResolvedValue({ ok: true });
    api.removeFromSchedule.mockResolvedValue({ done: 1 });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Scheduled blocks/ }));
    let items = await screen.findAllByTestId('scheduled-item');

    fireEvent.click(within(items[0]).getByRole('button', { name: 'Reschedule' }));
    const target = Date.now() + 5 * 86_400_000;
    const { date, time } = toInputs(target);
    fireEvent.change(within(items[0]).getByLabelText('Date'), { target: { value: date } });
    fireEvent.change(within(items[0]).getByLabelText('Time'), { target: { value: time } });
    await act(async () => { fireEvent.click(within(items[0]).getByRole('button', { name: 'Save' })); });
    expect(api.rescheduleSchedule).toHaveBeenCalledWith('S1', fromInputs(date, time));

    items = await screen.findAllByTestId('scheduled-item');
    fireEvent.click(within(items[1]).getByRole('button', { name: 'Cancel' }));
    await act(async () => { fireEvent.click(within(items[1]).getByRole('button', { name: 'Yes, cancel it' })); });
    expect(api.cancelSchedule).toHaveBeenCalledWith('S2');

    items = await screen.findAllByTestId('scheduled-item');
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Show students' }));
    await act(async () => { fireEvent.click(within(items[0]).getByRole('button', { name: 'Remove Dan Scheduled from this schedule' })); });
    expect(api.removeFromSchedule).toHaveBeenCalledWith([{ session: 'morning', phone: roster[3].id }]);
  });
});
