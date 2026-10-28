import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 003Fixes / 03 — a checkbox on every row, the header box for the page, then
 * "Select all N matching your filters", and the selection bar.
 */

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
// Counts row renders: every StudentRow render highlights its four text cells.
const hl = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@features/dashboard/search/highlightMatches', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, highlightMatches: (...args) => { hl.calls += 1; return real.highlightMatches(...args); } };
});

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); delete window.ontouchstart; });

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const T0 = Date.parse('2026-10-01T09:00:00+03:00');
const kid = (n, over = {}) => ({
  id: `+2547110${String(n).padStart(5, '0')}`,
  studentName: `Student ${String(n).padStart(3, '0')}`,
  parentPhone: `+2547110${String(n).padStart(5, '0')}`,
  class: n % 2 ? 'Form 3' : 'Grade 8',
  subjects: 'English',
  receiptMessage: 'QAB123XYZ9 Confirmed',
  receiptStatus: 'pending',
  approvalStatus: 'approved',
  blocked: false,
  feeBalance: 0,
  registeredAt: at(T0 - n * 60_000),
  ...over,
});
const roster = (n, over) => Array.from({ length: n }, (_, i) => kid(i + 1, typeof over === 'function' ? over(i + 1) : over));
const sessionDoc = { id: 'morning', name: 'Morning Session', classes: ['Grade 8', 'Form 3'] };

function renderPanel({ students = roster(45), extra = {} } = {}) {
  const noop = vi.fn();
  const props = {
    session: 'morning', sessionDoc, students, loading: false,
    onDelete: noop, onEdit: noop, onExport: noop, onBlock: noop, onUnblock: noop, onApprove: noop, onDecline: noop, onView: noop,
    ...extra,
  };
  const view = render(<MemoryRouter><StudentSearchPanel {...props} /></MemoryRouter>);
  const rerender = (over) => view.rerender(<MemoryRouter><StudentSearchPanel {...props} {...over} /></MemoryRouter>);
  return { ...view, rerender };
}

const rowBox = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const pageBox = () => screen.getByRole('checkbox', { name: 'Select all students on this page' });
const bar = async () => screen.findByRole('region', { name: 'Selected students' });
const barText = async () => (await bar()).textContent.replace(/\s+/g, ' ');
const pager = () => screen.getByRole('navigation', { name: 'Student list pages' });

describe('row checkboxes and the bar', () => {
  it('ticking rows shows "2 selected"; Clear empties it and the bar goes', async () => {
    renderPanel();
    expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull();
    fireEvent.click(rowBox('Student 001'));
    fireEvent.click(rowBox('Student 002'));
    expect(await barText()).toMatch(/2 selected/);
    fireEvent.click(within(await bar()).getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
    expect(rowBox('Student 001').checked).toBe(false);
  });

  it('ticking a box does not open the row popup or the drawer', async () => {
    window.ontouchstart = null;
    const onView = vi.fn();
    renderPanel({ extra: { onView } });
    fireEvent.click(rowBox('Student 001'));
    await bar();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onView).not.toHaveBeenCalled();
  });
});

describe('the header box and "select all matching"', () => {
  it('the header says what the boxes are for ("Select")', () => {
    renderPanel();
    const head = pageBox().closest('th');
    expect(head.textContent).toMatch(/Select/);
    expect(pageBox().closest('label').getAttribute('title')).toMatch(/block, unblock, schedule or approve/);
    expect(rowBox('Student 001').getAttribute('title')).toBe('Select this student');
  });

  it('selects the 20 on this page, then offers all 45 matching', async () => {
    renderPanel();
    fireEvent.click(pageBox());
    expect(await barText()).toMatch(/20 selected/);
    const offer = screen.getByTestId('select-all-matching');
    expect(offer.textContent).toMatch(/All 20 on this page are selected/);
    fireEvent.click(within(offer).getByRole('button', { name: /Select all 45 students matching your filters/ }));
    expect(await barText()).toMatch(/45 selected/);
    expect(screen.getByTestId('select-all-matching').textContent).toMatch(/All 45 selected/);
  });

  it('is part-ticked when some of the page is ticked; unticking it clears the page', async () => {
    renderPanel();
    fireEvent.click(rowBox('Student 001'));
    expect(pageBox().indeterminate).toBe(true);
    fireEvent.click(pageBox());
    expect(pageBox().checked).toBe(true);
    fireEvent.click(pageBox());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
  });

  it('shift-click selects a range on the page', async () => {
    renderPanel();
    fireEvent.click(rowBox('Student 002'));
    fireEvent.click(rowBox('Student 006'), { shiftKey: true });
    expect(await barText()).toMatch(/5 selected/);
    expect(rowBox('Student 004').checked).toBe(true);
  });
});

describe('what keeps and what clears the selection', () => {
  it('kept across page changes', async () => {
    renderPanel();
    fireEvent.click(rowBox('Student 001'));
    fireEvent.click(within(pager()).getByRole('button', { name: 'Next page' }));
    fireEvent.click(rowBox('Student 021'));
    expect(await barText()).toMatch(/2 selected/);
    fireEvent.click(within(pager()).getByRole('button', { name: 'First page' }));
    expect(rowBox('Student 001').checked).toBe(true);
  });

  it('cleared by a search, a chip, and "All sessions"', async () => {
    renderPanel({ extra: { sessions: [sessionDoc, { id: 'evening', name: 'Evening Session', classes: ['Grade 8'] }], studentsBySession: { morning: roster(45), evening: [] } } });
    fireEvent.click(rowBox('Student 001'));
    await bar();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search students/ }), { target: { value: 'student' } });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());

    fireEvent.click(rowBox('Student 003'));
    await bar();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /^Form 3/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());

    fireEvent.click(rowBox('Student 003'));
    await bar();
    fireEvent.click(screen.getByRole('checkbox', { name: /All sessions/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
  });

  it('a selected student who is deleted leaves the selection', async () => {
    const { rerender } = renderPanel({ students: roster(5) });
    fireEvent.click(rowBox('Student 001'));
    fireEvent.click(rowBox('Student 002'));
    expect(await barText()).toMatch(/2 selected/);
    rerender({ students: roster(5).slice(1) });
    expect(await barText()).toMatch(/1 selected/);
  });

  it('switching session tab clears it', async () => {
    const { rerender } = renderPanel({ students: roster(5) });
    fireEvent.click(rowBox('Student 001'));
    await bar();
    rerender({ session: 'evening', sessionDoc: { ...sessionDoc, id: 'evening' }, students: roster(3) });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
  });
});

describe('the action follows the status filter', () => {
  const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' }))
    .getByRole('button', { name: new RegExp(`^${label}\\b`) });

  it('no status filter → Block selected; Blocked → Unblock selected; Receipt to review → Approve receipts', async () => {
    const students = roster(6, (n) => ({ blocked: n <= 2, pendingReceipt: n <= 1 ? 'QZZ9988776 Confirmed' : undefined }));
    renderPanel({ students });
    fireEvent.click(rowBox('Student 003'));
    expect(within(await bar()).getByRole('button', { name: 'Block selected' })).toBeTruthy();

    fireEvent.click(statusChip('Blocked'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
    fireEvent.click(rowBox('Student 002'));
    expect(within(await bar()).getByRole('button', { name: 'Unblock selected' })).toBeTruthy();

    fireEvent.click(statusChip('Blocked'));
    fireEvent.click(statusChip('Receipt to review'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected students' })).toBeNull());
    fireEvent.click(rowBox('Student 001'));
    expect(within(await bar()).getByRole('button', { name: 'Approve receipts' })).toBeTruthy();
  });
});

describe('all sessions', () => {
  it('the same number in two sessions is two separate selections', async () => {
    const shared = kid(1);
    const evening = [{ ...shared, studentName: 'Student 001', class: 'Grade 8' }];
    renderPanel({
      students: [shared],
      extra: { sessions: [sessionDoc, { id: 'evening', name: 'Evening Session', classes: ['Grade 8'] }], studentsBySession: { morning: [shared], evening } },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /All sessions/ }));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Select Student 001' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Student 001' })[0]);
    expect(await barText()).toMatch(/1 selected/);
    const boxes = screen.getAllByRole('checkbox', { name: 'Select Student 001' });
    expect(boxes.filter((b) => b.checked)).toHaveLength(1);
  });
});

describe('performance', () => {
  it('ticking one row re-renders only that row', async () => {
    renderPanel();
    await act(async () => {});
    const before = hl.calls;
    fireEvent.click(rowBox('Student 005'));
    await bar();
    // One row re-rendered = its four highlighted cells, nothing more.
    expect(hl.calls - before).toBe(4);
  });
});
