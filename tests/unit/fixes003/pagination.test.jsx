import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 003Fixes / 02 — the student list shows 20 rows per page, with First,
 * Previous, Next and Last. Paging re-slices the roster already in memory:
 * no request, no listener, nothing outside the table changes.
 */

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const T0 = Date.parse('2026-10-01T09:00:00+03:00');
// Newest first is the default sort, so student 1 (the latest) is row 1.
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
const roster = (n) => Array.from({ length: n }, (_, i) => kid(i + 1));
const sessionDoc = { id: 'morning', name: 'Morning Session', classes: ['Grade 8', 'Form 3'] };

function renderPanel({ students = roster(45), onExport = vi.fn(), extra = {} } = {}) {
  const noop = vi.fn();
  const props = {
    session: 'morning', sessionDoc, students, loading: false,
    onDelete: noop, onEdit: noop, onExport, onBlock: noop, onUnblock: noop, onApprove: noop, onDecline: noop,
    ...extra,
  };
  const view = render(<MemoryRouter><StudentSearchPanel {...props} /></MemoryRouter>);
  const rerender = (over) => view.rerender(<MemoryRouter><StudentSearchPanel {...props} {...over} /></MemoryRouter>);
  return { ...view, rerender, onExport };
}

const rowNames = () => [...document.querySelectorAll('tr.student-row-wrapper td:nth-child(2) strong:not(.text-primary)')]
  .map((el) => el.textContent);
const rowNumbers = () => [...document.querySelectorAll('tr.student-row-wrapper td:first-child strong')].map((el) => Number(el.textContent));
const pager = () => screen.getByRole('navigation', { name: 'Student list pages' });
const btn = (name) => within(pager()).getByRole('button', { name });
const label = () => within(pager()).getByTestId('page-label').textContent;

describe('20 rows per page', () => {
  it('shows the first 20, numbered 1–20, with "Page 1 of 3"', () => {
    renderPanel();
    expect(rowNames()).toHaveLength(20);
    expect(rowNames()[0]).toBe('Student 001');
    expect(rowNumbers()[0]).toBe(1);
    expect(label()).toMatch(/Page 1 of 3/);
    expect(btn('First page')).toBeDisabled();
    expect(btn('Previous page')).toBeDisabled();
    expect(btn('Next page')).not.toBeDisabled();
  });

  it('Next, Last, Previous and First move through the pages; numbering continues', () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    expect(rowNames()[0]).toBe('Student 021');
    expect(rowNumbers()[0]).toBe(21);
    expect(label()).toMatch(/Page 2 of 3/);
    fireEvent.click(btn('Last page'));
    expect(rowNames()).toHaveLength(5);
    expect(rowNames().at(-1)).toBe('Student 045');
    expect(btn('Next page')).toBeDisabled();
    expect(btn('Last page')).toBeDisabled();
    fireEvent.click(btn('Previous page'));
    expect(label()).toMatch(/Page 2 of 3/);
    fireEvent.click(btn('First page'));
    expect(label()).toMatch(/Page 1 of 3/);
  });

  it('after a page change only the new page is in the table (no rows left over from the old one)', () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    expect(document.querySelectorAll('tr.student-row-wrapper')).toHaveLength(20);
    expect(rowNumbers()[0]).toBe(21);
    expect(rowNumbers()).not.toContain(1);
  });

  it('the footer says which rows are shown, out of how many', () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    expect(screen.getByTestId('table-total').textContent).toMatch(/21–40 of 45/);
  });

  it('20 or fewer students: no page buttons at all', () => {
    renderPanel({ students: roster(20) });
    expect(screen.queryByRole('navigation', { name: 'Student list pages' })).toBeNull();
    expect(rowNames()).toHaveLength(20);
  });
});

describe('back to page 1 when what is shown changes', () => {
  it('typing a search', async () => {
    renderPanel();
    fireEvent.click(btn('Last page'));
    fireEvent.change(screen.getByRole('searchbox', { name: /Search students/ }), { target: { value: 'student' } });
    await waitFor(() => expect(label()).toMatch(/Page 1 of 3/));
  });

  it('ticking a class chip', async () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /^Form 3/ }));
    await waitFor(() => expect(label()).toMatch(/Page 1 of 2/));
    expect(rowNames()[0]).toBe('Student 001');
  });

  it('changing the sort', async () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    fireEvent.change(screen.getByLabelText('Sort students'), { target: { value: 'oldest' } });
    await waitFor(() => expect(label()).toMatch(/Page 1 of 3/));
    expect(rowNames()[0]).toBe('Student 045');
  });
});

describe('live roster changes', () => {
  it('students removed while on the last page: the page is pulled back to the new last page', () => {
    const { rerender } = renderPanel();
    fireEvent.click(btn('Last page'));
    rerender({ students: roster(30) });
    expect(label()).toMatch(/Page 2 of 2/);
    expect(rowNames()).toHaveLength(10);
  });

  it('students added: the teacher stays on the page they were on', () => {
    const { rerender } = renderPanel();
    fireEvent.click(btn('Next page'));
    rerender({ students: roster(70) });
    expect(label()).toMatch(/Page 2 of 4/);
  });
});

describe('no requests, and what else stays the same', () => {
  it('paging calls nothing on the network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPanel();
    fireEvent.click(btn('Next page'));
    fireEvent.click(btn('Last page'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('Export on page 2 still exports the whole filtered list', async () => {
    const { onExport } = renderPanel();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /^Grade 8/ }));
    await waitFor(() => expect(label()).toMatch(/Page 1 of 2/));
    fireEvent.click(btn('Next page'));
    fireEvent.click(screen.getByRole('button', { name: /Export to PDF/ }));
    const [, view] = onExport.mock.calls[0];
    expect(view.students).toHaveLength(22);
  });

  it('the page survives leaving the dashboard and coming back (this tab)', () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    cleanup();
    renderPanel();
    expect(label()).toMatch(/Page 2 of 3/);
  });

  it('sign-out clears the saved page with the saved search (its key holds the search text)', async () => {
    renderPanel();
    fireEvent.click(btn('Next page'));
    expect(sessionStorage.getItem('dashboard.studentPage.v1')).toBeTruthy();
    const { clearStoredSearch } = await import('@features/dashboard/search/searchStorage');
    clearStoredSearch();
    expect(sessionStorage.getItem('dashboard.studentPage.v1')).toBeNull();
  });

  it('all sessions: pages run across sessions and actions still go to each row\'s own session', async () => {
    const morning = roster(15);
    const evening = Array.from({ length: 15 }, (_, i) => kid(100 + i, { studentName: `Evening ${String(i + 1).padStart(2, '0')}` }));
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderPanel({
      students: morning,
      extra: {
        onDelete,
        sessions: [sessionDoc, { id: 'evening', name: 'Evening Session', classes: ['Grade 8', 'Form 3'] }],
        studentsBySession: { morning, evening },
      },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /All sessions/ }));
    await waitFor(() => expect(label()).toMatch(/Page 1 of 2/));
    fireEvent.click(btn('Next page'));
    const row = [...document.querySelectorAll('tr.student-row-wrapper')].find((tr) => tr.textContent.includes('Evening 15'));
    expect(row).toBeTruthy();
    fireEvent.click(within(row).getByTitle('Delete student'));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm|^Delete$/ }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('evening', expect.any(String), 'Evening 15'));
  });
});
