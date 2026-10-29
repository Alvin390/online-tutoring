import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/context/ToastContext';

/**
 * 003Fixes / 13 — the teacher sees and settles duplicates: a held
 * registration is marked in the approval list (Approve / Decline as duplicate
 * / Compare) and left out of "Approve all"; "Possible duplicates" lists every
 * pair from the rosters already loaded (no reads) with Merge / Decline one /
 * Keep both, and Retired numbers with Allow again; a status chip finds them.
 */

const api = vi.hoisted(() => ({
  BulkInterrupted: class extends Error {},
  DEFAULT_LIMITS: { block: 25, blockFees: 25, unblock: 25, approveReceipts: 25 },
  runBulk: vi.fn(), undoBulk: vi.fn(), listBulkActions: vi.fn(),
  runSchedule: vi.fn(), removeFromSchedule: vi.fn(), listSchedules: vi.fn(), rescheduleSchedule: vi.fn(), cancelSchedule: vi.fn(),
  declineDuplicate: vi.fn(), mergeDuplicates: vi.fn(), keepBothDuplicates: vi.fn(), allowRetiredNumber: vi.fn(), listRetiredNumbers: vi.fn(),
}));
vi.mock('@services/api/students', () => api);
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));

beforeEach(() => {
  sessionStorage.clear();
  for (const fn of Object.values(api)) if (fn?.mockReset) fn.mockReset();
  api.declineDuplicate.mockResolvedValue({ ok: true });
  api.mergeDuplicates.mockResolvedValue({ ok: true, done: true });
  api.keepBothDuplicates.mockResolvedValue({ ok: true });
  api.allowRetiredNumber.mockResolvedValue({ ok: true });
  api.listRetiredNumbers.mockResolvedValue({ retired: [{ session: 'morning', phone: '+254711000500', reason: 'merged', keptSuffix: '678' }] });
});
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const RECEIPT = 'QX12345678 Confirmed. Ksh1,000.00 sent to TEACHER';
const kid = (phone, name, over = {}) => ({
  id: phone, parentPhone: phone, studentName: name, class: 'Grade 7', subjects: 'English, Maths', session: 'morning',
  receiptMessage: RECEIPT, receiptStatus: 'approved', approvalStatus: 'approved', blocked: false, feeBalance: 0,
  registeredAt: at(Date.parse('2026-10-01T09:00:00Z')), ...over,
});
const ORIGINAL = kid('+254711000678', 'Amina Wanjiru', { lastAccessed: at(Date.parse('2026-10-20T06:00:00Z')) });
const HELD = kid('+254711000679', 'amina wanjiru', {
  approvalStatus: 'pending', duplicateHold: true, duplicateOf: '+254711000678', lastAccessed: at(Date.parse('2026-10-25T06:00:00Z')),
  registeredAt: at(Date.parse('2026-10-24T09:00:00Z')),
});
const NEW1 = kid('+254722000001', 'Brian Otieno', { approvalStatus: 'pending', receiptMessage: 'AB11111111 ok' });
const NEW2 = kid('+254722000002', 'Chebet Kiprop', { approvalStatus: 'pending', receiptMessage: 'AB22222222 ok' });
const KEPT_A = kid('+254733000001', 'Dan Mwangi', { receiptMessage: 'DM12345678 ok', duplicateKeep: ['+254733000002'] });
const KEPT_B = kid('+254733000002', 'Dan Mwangi', { receiptMessage: 'DM12345678 ok', duplicateKeep: ['+254733000001'] });
const roster = [ORIGINAL, HELD, NEW1, NEW2, KEPT_A, KEPT_B];

describe('the approval list', () => {
  async function renderQueue() {
    const { default: PendingApprovalsPanel } = await import('@features/dashboard/components/PendingApprovalsPanel.jsx');
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <PendingApprovalsPanel pending={[HELD, NEW1, NEW2]} rosters={{ morning: roster }} onApprove={onApprove} onReject={onReject} loading={false} sessions={[]} />
      </ToastProvider>
    );
    return { onApprove, onReject };
  }

  it('a held duplicate is marked, says what it matched, and has Approve / Decline as duplicate / Compare', async () => {
    const { onApprove } = await renderQueue();
    const card = screen.getByTestId('pending-duplicate');
    expect(within(card).getByText('Possible duplicate')).toBeTruthy();
    expect(card.textContent).toMatch(/Same name, class and receipt as Amina Wanjiru \(number ending …678\)/);
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Approve' })); });
    expect(onApprove).toHaveBeenCalledWith('morning', [HELD.id]);
    expect(within(card).getByRole('button', { name: 'Decline as duplicate' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Compare' })).toBeTruthy();
  });

  it('Decline as duplicate confirms, then declines', async () => {
    await renderQueue();
    const card = screen.getByTestId('pending-duplicate');
    fireEvent.click(within(card).getByRole('button', { name: 'Decline as duplicate' }));
    expect(api.declineDuplicate).not.toHaveBeenCalled();
    expect(card.textContent).toMatch(/registered twice/);
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Yes, decline …679' })); });
    expect(api.declineDuplicate).toHaveBeenCalledWith('morning', HELD.id);
  });

  it('Compare opens the side-by-side view in place', async () => {
    await renderQueue();
    const card = screen.getByTestId('pending-duplicate');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Compare' })); });
    expect(await within(card).findByTestId('duplicate-pair')).toBeTruthy();
  });

  it('"Approve all" leaves held duplicates out and says so', async () => {
    const { onApprove } = await renderQueue();
    fireEvent.click(screen.getByRole('button', { name: /Approve all 2 \(1 possible duplicate needs a look\)/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, approve all' })); });
    expect(onApprove).toHaveBeenCalledWith('morning', [NEW1.id, NEW2.id]);
  });
});

describe('Possible duplicates', () => {
  async function renderPanel(list = roster) {
    const { default: DuplicatesPanel } = await import('@features/dashboard/components/duplicates/DuplicatesPanel.jsx');
    const onClose = vi.fn();
    render(<DuplicatesPanel rosters={{ morning: list }} sessionNames={{ morning: 'Morning' }} onClose={onClose} showSuccess={vi.fn()} showError={vi.fn()} />);
    return { onClose };
  }

  it('lists the pairs from the rosters with why they matched; a pair kept earlier is left out', async () => {
    await renderPanel();
    const pairs = await screen.findAllByTestId('duplicate-pair');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].textContent).toMatch(/Same receipt/);
    expect(pairs[0].textContent).toMatch(/…678/);
    expect(pairs[0].textContent).toMatch(/…679/);
    expect(pairs[0].textContent).not.toMatch(/Dan Mwangi/);
  });

  it('draws 20 pairs at a time, with Show more', async () => {
    const many = Array.from({ length: 25 }, (_, i) => [
      kid(`+2547440${String(i).padStart(5, '0')}`, `Twin ${i}`, { receiptMessage: `TW${String(i).padStart(8, '0')} ok` }),
      kid(`+2547550${String(i).padStart(5, '0')}`, `Twin ${i}`, { receiptMessage: `TW${String(i).padStart(8, '0')} ok` }),
    ]).flat();
    await renderPanel(many);
    expect(await screen.findAllByTestId('duplicate-pair')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more (5 not shown)' }));
    expect(screen.getAllByTestId('duplicate-pair')).toHaveLength(25);
  });

  it('Merge defaults to the record checked in most recently, names both numbers, then merges', async () => {
    await renderPanel();
    const pair = (await screen.findAllByTestId('duplicate-pair'))[0];
    fireEvent.click(within(pair).getByRole('button', { name: 'Merge' }));
    expect(within(pair).getByRole('radio', { name: /Keep …679/ }).checked).toBe(true);
    expect(pair.textContent).toMatch(/Keep …679, remove …678\. Notes and fee history move to …679\. …678 will be told to use …679\./);
    await act(async () => { fireEvent.click(within(pair).getByRole('button', { name: 'Yes, merge' })); });
    expect(api.mergeDuplicates).toHaveBeenCalledWith('morning', HELD.id, ORIGINAL.id);
  });

  it('a block difference is warned about before merging', async () => {
    await renderPanel([{ ...ORIGINAL, blocked: true }, HELD]);
    const pair = (await screen.findAllByTestId('duplicate-pair'))[0];
    fireEvent.click(within(pair).getByRole('button', { name: 'Merge' }));
    expect(pair.textContent).toMatch(/…678 is blocked and …679 is not/);
  });

  it('Decline one: choose which, see the message it will get, decline', async () => {
    await renderPanel();
    const pair = (await screen.findAllByTestId('duplicate-pair'))[0];
    fireEvent.click(within(pair).getByRole('button', { name: 'Decline one' }));
    fireEvent.click(within(pair).getByRole('radio', { name: /Decline …679/ }));
    expect(pair.textContent).toMatch(/This number was registered twice/);
    await act(async () => { fireEvent.click(within(pair).getByRole('button', { name: 'Yes, decline …679' })); });
    expect(api.declineDuplicate).toHaveBeenCalledWith('morning', HELD.id);
  });

  it('Keep both confirms, then keeps both', async () => {
    await renderPanel();
    const pair = (await screen.findAllByTestId('duplicate-pair'))[0];
    fireEvent.click(within(pair).getByRole('button', { name: 'Keep both' }));
    await act(async () => { fireEvent.click(within(pair).getByRole('button', { name: 'Yes, keep both' })); });
    expect(api.keepBothDuplicates).toHaveBeenCalledWith('morning', ORIGINAL.id, HELD.id);
  });

  it('Retired numbers (collapsed) load on open; Allow again lifts one', async () => {
    await renderPanel();
    expect(api.listRetiredNumbers).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Retired numbers/ })); });
    expect(api.listRetiredNumbers).toHaveBeenCalledWith(['morning']);
    const item = await screen.findByTestId('retired-item');
    expect(item.textContent).toMatch(/\+254711000500/);
    expect(item.textContent).toMatch(/merged into …678/);
    await act(async () => { fireEvent.click(within(item).getByRole('button', { name: 'Allow again' })); });
    expect(api.allowRetiredNumber).toHaveBeenCalledWith('morning', '+254711000500');
  });
});

describe('the student list', () => {
  it('the toolbar badge counts pairs and the "Possible duplicate" chip counts the records in them', async () => {
    const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
    const noop = vi.fn();
    render(
      <ToastProvider>
        <MemoryRouter>
          <StudentSearchPanel
            session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Grade 7'], schedule: null }}
            students={roster} loading={false}
            onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
          />
        </MemoryRouter>
      </ToastProvider>
    );
    expect(screen.getByRole('button', { name: 'Possible duplicates (1)' })).toBeTruthy();
    const chip = within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /^Possible duplicate\b/ });
    expect(chip.textContent).toMatch(/2/);
    fireEvent.click(chip);
    await waitFor(() => expect(document.querySelectorAll('tr.student-row-wrapper')).toHaveLength(2));
  });
});

describe('speed', () => {
  it('duplicatePairs on 5,000 students under 10 ms (warm)', async () => {
    const { duplicatePairs } = await import('@features/dashboard/duplicates/duplicatePairs');
    const many = Array.from({ length: 5000 }, (_, i) => kid(`+2547${String(10000000 + i * 13).slice(0, 8)}`, `Student ${i % 4500}`, { class: `Grade ${i % 5}`, receiptMessage: `R${String(i).padStart(9, '0')} x` }));
    duplicatePairs([...many]);
    // Best of 15 fresh snapshots (each a new array, so nothing is cached):
    // one slow run on a loaded test machine is noise, not the cost.
    let best = Infinity;
    for (let i = 0; i < 15; i += 1) {
      const fresh = [...many];
      const t0 = performance.now();
      duplicatePairs(fresh);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(10);
  });
});
