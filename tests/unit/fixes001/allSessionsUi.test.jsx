import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 001Fixes / 06 — "All sessions" search, and Export PDF follows the filter.
 *
 * Safety-critical: in the all-sessions view every row action must go to the
 * ROW'S OWN session, never the open tab — and the same parent phone can be
 * registered in two sessions.
 */

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  delete window.ontouchstart;
});

const at = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const kid = (id, studentName, cls, over = {}) => ({
  id, studentName, parentPhone: id, class: cls, subjects: 'English, Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending', approvalStatus: 'approved',
  blocked: false, feeBalance: 0, registeredAt: at('2026-10-01T09:00:00+03:00'), ...over,
});

const SHARED_PHONE = '+254700111222';
const morning = [
  kid('+254711000001', 'Amina Wanjiru', 'Form 3', { registeredAt: at('2026-10-05T10:00:00+03:00') }),
  kid(SHARED_PHONE, 'Twin Kamau', 'Grade 8', { registeredAt: at('2026-10-04T10:00:00+03:00') }),
];
const evening = [
  kid('+254722000001', 'Faith Otieno', 'Adult Class', {
    registeredAt: at('2026-10-06T10:00:00+03:00'),
    blocked: true, receiptStatus: 'pending', pendingReceipt: 'QZZ9988776 Confirmed',
  }),
  kid(SHARED_PHONE, 'Twin Kamau', 'Grade 10', { registeredAt: at('2026-10-03T10:00:00+03:00') }),
];
const sessions = [
  { id: 'morning', name: 'Morning Session', active: true, classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'] },
  { id: 'evening', name: 'Evening Session', active: true, classes: ['Adult Class', 'Grade 10'] },
];
const studentsBySession = { morning, evening };

function renderPanel(handlers = {}) {
  const fns = {
    onDelete: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue({ success: true }),
    onExport: vi.fn(),
    onBlock: vi.fn().mockResolvedValue({ success: true }),
    onUnblock: vi.fn().mockResolvedValue({ success: true }),
    onApprove: vi.fn().mockResolvedValue({ success: true }),
    onDecline: vi.fn().mockResolvedValue({ success: true }),
    onView: vi.fn(),
    ...handlers,
  };
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <StudentSearchPanel
        session="morning"
        sessionDoc={sessions[0]}
        students={morning}
        sessions={sessions}
        studentsBySession={studentsBySession}
        loading={false}
        {...fns}
      />
    </MemoryRouter>
  );
  return fns;
}

const rows = () => [...document.querySelectorAll('tr.student-row-wrapper')];
const rowNames = () => rows().map((tr) => tr.querySelector('td:nth-child(2) strong:not(.text-primary)').textContent);
const rowFor = (name, sessionName) => rows().find((tr) =>
  tr.textContent.includes(name) && (!sessionName || tr.querySelector('[data-testid="row-session"]')?.textContent === sessionName));
const allSessions = () => screen.getByRole('checkbox', { name: /All sessions/ });

// ---------------------------------------------------------------------------
describe('All sessions', () => {
  it('searches every session; each row says which session it is from', async () => {
    renderPanel();
    expect(rowNames()).toEqual(['Amina Wanjiru', 'Twin Kamau']);
    expect(document.querySelector('[data-testid="row-session"]')).toBeNull();
    fireEvent.click(allSessions());
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(rowFor('Faith Otieno').querySelector('[data-testid="row-session"]').textContent).toBe('Evening Session');
    expect(screen.getByTestId('search-summary').textContent).toMatch(/across all sessions/);
  });

  it('the same phone in two sessions is two rows, not a collision', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPanel();
    fireEvent.click(allSessions());
    fireEvent.change(screen.getByRole('searchbox', { name: /Search students/ }), { target: { value: 'twin' } });
    await waitFor(() => expect(rowNames()).toEqual(['Twin Kamau', 'Twin Kamau']));
    expect(rowFor('Twin Kamau', 'Morning Session')).toBeTruthy();
    expect(rowFor('Twin Kamau', 'Evening Session')).toBeTruthy();
    expect(error.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    error.mockRestore();
  });

  it('class chips cover every session\'s classes', async () => {
    renderPanel();
    const classGroup = () => screen.getByRole('group', { name: 'Filter by class' });
    expect(within(classGroup()).queryByRole('button', { name: /^Adult Class/ })).toBeNull();
    fireEvent.click(allSessions());
    await waitFor(() => expect(within(classGroup()).getByRole('button', { name: /^Adult Class/ })).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
describe('row actions in the all-sessions view go to the row\'s own session', () => {
  async function showAll() {
    fireEvent.click(allSessions());
    await waitFor(() => expect(rows()).toHaveLength(4));
  }

  it('delete', async () => {
    const fns = renderPanel();
    await showAll();
    fireEvent.click(within(rowFor('Twin Kamau', 'Evening Session')).getByTitle('Delete student'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Confirm|^Delete$/ })); });
    expect(fns.onDelete).toHaveBeenCalledWith('evening', SHARED_PHONE, 'Twin Kamau');
  });

  it('edit', async () => {
    const fns = renderPanel();
    await showAll();
    fireEvent.click(within(rowFor('Twin Kamau', 'Evening Session')).getByTitle('Edit student'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Confirm/ })); });
    expect(fns.onEdit).toHaveBeenCalled();
    expect(fns.onEdit.mock.calls[0][0]).toBe('evening');
    expect(fns.onEdit.mock.calls[0][3]).toBe(SHARED_PHONE);
  });

  it('block', async () => {
    const fns = renderPanel();
    await showAll();
    fireEvent.click(within(rowFor('Twin Kamau', 'Evening Session')).getByTitle('Block student'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/Evening Session/);
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm/ })); });
    expect(fns.onBlock).toHaveBeenCalledWith('evening', SHARED_PHONE, 'Twin Kamau', '');
  });

  it('unblock, approve and decline (from the row\'s popup)', async () => {
    window.ontouchstart = null; // the popup opens on tap on touch screens
    const fns = renderPanel();
    await showAll();
    const openPopup = async () => {
      fireEvent.click(rowFor('Faith Otieno'));
      return within(await screen.findByRole('dialog', { name: /Details for Faith Otieno/ }));
    };
    let popup = await openPopup();
    await act(async () => { fireEvent.click(popup.getByRole('button', { name: /Approve/ })); });
    expect(fns.onApprove).toHaveBeenCalledWith('evening', '+254722000001', 'Faith Otieno');
    popup = await openPopup();
    await act(async () => { fireEvent.click(popup.getByRole('button', { name: /Decline/ })); });
    expect(fns.onDecline).toHaveBeenCalledWith('evening', '+254722000001', 'Faith Otieno');
    popup = await openPopup();
    await act(async () => { fireEvent.click(popup.getByRole('button', { name: /Cancel Block/ })); });
    expect(fns.onUnblock).toHaveBeenCalledWith('evening', '+254722000001', 'Faith Otieno');
  });

  it('the details drawer is told the row\'s session', async () => {
    const fns = renderPanel();
    await showAll();
    fireEvent.click(within(rowFor('Twin Kamau', 'Evening Session')).getByRole('button', { name: /Open details and notes/ }));
    expect(fns.onView).toHaveBeenCalledWith(expect.objectContaining({ id: SHARED_PHONE, __session: 'evening' }));
  });
});

// ---------------------------------------------------------------------------
describe('matches hidden in other sessions', () => {
  it('offers to search all sessions when the open one has no match', async () => {
    renderPanel();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search students/ }), { target: { value: 'faith' } });
    const empty = await screen.findByTestId('no-results');
    expect(empty.textContent).toMatch(/1 match in other sessions/);
    fireEvent.click(within(empty).getByRole('button', { name: /Search all sessions/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Faith Otieno']));
    expect(allSessions().checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('Export PDF follows the view', () => {
  const exportButton = () => screen.getByRole('button', { name: /Export to PDF/ });

  it('no filter: exactly today\'s whole-session export', () => {
    const fns = renderPanel();
    fireEvent.click(exportButton());
    expect(fns.onExport).toHaveBeenCalledWith('morning');
  });

  it('filtered: the students shown, and a subtitle naming the filter', async () => {
    const fns = renderPanel();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /^Form 3/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru']));
    fireEvent.click(exportButton());
    const [session, view] = fns.onExport.mock.calls[0];
    expect(session).toBe('morning');
    expect(view.students.map((s) => s.studentName)).toEqual(['Amina Wanjiru']);
    expect(view.subtitle).toMatch(/Form 3/);
    expect(view.allSessions).toBe(false);
  });

  it('all sessions: every session\'s matches, flagged for a Session column', async () => {
    const fns = renderPanel();
    fireEvent.click(allSessions());
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(exportButton());
    const [, view] = fns.onExport.mock.calls[0];
    expect(view.allSessions).toBe(true);
    expect(view.students).toHaveLength(4);
    expect(view.students.every((s) => s.__session)).toBe(true);
  });
});

describe('the PDF itself', () => {
  it('adds the filter line and a Session column only when asked', async () => {
    const { buildStudentsPdf } = await import('@/features/dashboard/hooks/studentsPdf');
    const students = [
      { ...morning[0], __session: 'morning' },
      { ...evening[0], __session: 'evening' },
    ];
    const doc = await buildStudentsPdf({
      sessionName: 'All sessions', students, subtitle: 'Search "a" · Form 3',
      sessionNames: { morning: 'Morning Session', evening: 'Evening Session' }, includeSession: true,
    });
    const pdf = doc.output();
    expect(pdf).toContain('All sessions - Student List');
    expect(pdf).toContain('Filtered: Search');
    expect(pdf).toContain('(Session)'); // the column header
    // The 22 mm Session column wraps "Evening Session" onto two lines, each
    // its own text run in the PDF.
    expect(pdf).toContain('(Evening)');
    expect(pdf).toContain('(Morning)');
  });
});
