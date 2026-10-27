import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StudentSearchPanel from '@features/dashboard/components/StudentSearchPanel.jsx';

/**
 * 001Fixes / 05 — status, subject, date and sort filters; the phone "Filters"
 * panel; "Did you mean …?" when nothing matches.
 */

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

const at = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const kid = (id, studentName, cls, over = {}) => ({
  id, studentName, parentPhone: id, class: cls, subjects: 'English, Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending', approvalStatus: 'approved',
  blocked: false, feeBalance: 0, registeredAt: at('2026-10-01T09:00:00+03:00'), ...over,
});
const roster = [
  kid('+254711000001', 'Amina Wanjiru', 'Form 3', { subjects: 'English, Biology', registeredAt: at('2026-10-05T10:00:00+03:00') }),
  kid('+254711000002', "Sean O'Brien", 'Grade 10', { subjects: 'Physics', feeBalance: 1500, registeredAt: at('2026-10-04T10:00:00+03:00') }),
  kid('+254711000003', 'Zoë Achieng', 'Grade 7', { blocked: true, registeredAt: at('2026-10-03T23:30:00+03:00') }),
  kid('+254722333444', 'Brian Otieno', 'Form 3', { subjects: 'English, Chemistry', pendingReceipt: 'QZZ9988776 Confirmed', registeredAt: at('2026-10-02T10:00:00+03:00') }),
  kid('+254733000005', 'Mercy Wambui', 'Grade 8', { approvalStatus: 'pending', registeredAt: at('2026-10-01T10:00:00+03:00') }),
];
const sessionDoc = {
  id: 'morning', name: 'Morning Session', classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'],
  subjectsByClass: { 'Form 3': [{ name: 'English', compulsory: true }, { name: 'Biology' }, { name: 'Chemistry' }] },
};

function renderPanel(students = roster) {
  const noop = vi.fn();
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <StudentSearchPanel
        session="morning" sessionDoc={sessionDoc} students={students} loading={false}
        onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop}
      />
    </MemoryRouter>
  );
}

const rowNames = () => [...document.querySelectorAll('tr.student-row-wrapper td:nth-child(2) strong:not(.text-primary)')]
  .map((el) => el.textContent);
const statusChip = (label) => within(screen.getByRole('group', { name: 'Filter by status' }))
  .getByRole('button', { name: new RegExp(`^${label}\\b`) });
const searchBox = () => screen.getByRole('searchbox', { name: /Search students/ });

// ---------------------------------------------------------------------------
describe('status chips', () => {
  it('each status shows its count and its students', async () => {
    renderPanel();
    expect(statusChip('Owes fees').textContent).toMatch(/1/);
    fireEvent.click(statusChip('Owes fees'));
    expect(statusChip('Owes fees').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(rowNames()).toEqual(["Sean O'Brien"]));
    fireEvent.click(statusChip('Blocked'));
    await waitFor(() => expect(rowNames()).toEqual(["Sean O'Brien", 'Zoë Achieng']));
  });

  it('"Receipt to review" means a receipt was actually sent, not just receiptStatus "pending"', async () => {
    renderPanel();
    // Everyone here has receiptStatus 'pending'; only Brian sent a receipt.
    expect(statusChip('Receipt to review').textContent).toMatch(/1/);
    fireEvent.click(statusChip('Receipt to review'));
    await waitFor(() => expect(rowNames()).toEqual(['Brian Otieno']));
  });

  it('a status with nobody in it is greyed, not hidden', () => {
    renderPanel();
    expect(statusChip('Rejected').className).toMatch(/is-empty/);
    expect(statusChip('Awaiting approval').className).not.toMatch(/is-empty/);
  });
});

// ---------------------------------------------------------------------------
describe('subject filter', () => {
  const openSubjects = () => fireEvent.click(screen.getByRole('button', { name: /^Subject/ }));
  const subjectList = () => screen.getByRole('group', { name: 'Filter by subject' });

  it('lists every subject with its count and filters by the ones ticked', async () => {
    renderPanel();
    openSubjects();
    const list = subjectList();
    expect(within(list).getByLabelText(/^Physics/)).toBeTruthy();
    fireEvent.click(within(list).getByLabelText(/^Biology/));
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru']));
    expect(screen.getByRole('button', { name: /^Subject/ }).textContent).toMatch(/1/);
  });

  it('offers only the subjects of the classes selected', async () => {
    renderPanel();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /^Form 3\b/ }));
    openSubjects();
    const labels = within(subjectList()).getAllByRole('checkbox').map((c) => c.closest('label, .form-check').textContent);
    expect(labels.join(' ')).toMatch(/Biology/);
    expect(labels.join(' ')).toMatch(/Chemistry/);
    expect(labels.join(' ')).not.toMatch(/Physics/);
  });
});

// ---------------------------------------------------------------------------
describe('dates and sort', () => {
  it('registered between two dates (Nairobi days)', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Registered from'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Registered to'), { target: { value: '2026-10-03' } });
    // Zoë registered 23:30 EAT on 3 Oct — still 3 Oct in Nairobi.
    await waitFor(() => expect(rowNames()).toEqual(['Zoë Achieng']));
    expect(screen.getByTestId('search-summary').textContent).toMatch(/Registered/);
  });

  it('sort options reorder the list', async () => {
    renderPanel();
    const sort = screen.getByLabelText('Sort students');
    fireEvent.change(sort, { target: { value: 'name' } });
    await waitFor(() => expect(rowNames()[0]).toBe('Amina Wanjiru'));
    fireEvent.change(sort, { target: { value: 'oldest' } });
    await waitFor(() => expect(rowNames()[0]).toBe('Mercy Wambui'));
    fireEvent.change(sort, { target: { value: 'balance' } });
    await waitFor(() => expect(rowNames()[0]).toBe("Sean O'Brien"));
  });
});

// ---------------------------------------------------------------------------
describe('the phone "Filters" panel', () => {
  it('a toggle shows how many extra filters are on, and opens and closes the panel without losing them', async () => {
    renderPanel();
    const toggle = screen.getByRole('button', { name: /^Filters/ });
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.className).not.toMatch(/is-open/);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.className).toMatch(/is-open/);
    fireEvent.click(statusChip('Blocked'));
    fireEvent.change(screen.getByLabelText('Sort students'), { target: { value: 'name' } });
    expect(toggle.textContent).toMatch(/2/);
    fireEvent.click(toggle);
    expect(panel.className).not.toMatch(/is-open/);
    expect(statusChip('Blocked').getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
describe('nothing matches', () => {
  it('suggests the closest name and applies it in one tap', async () => {
    renderPanel();
    // One edit per word ("amnia wnajiru") is found by the search's own typo
    // tolerance; "wnajiur" is two edits from "wanjiru" (too far for a
    // 7-letter word in search, close enough to suggest).
    fireEvent.change(searchBox(), { target: { value: 'amnia wnajiur' } });
    const empty = await screen.findByTestId('no-results');
    const suggestion = within(empty).getByRole('button', { name: /Amina Wanjiru/ });
    fireEvent.click(suggestion);
    expect(searchBox().value).toBe('Amina Wanjiru');
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru']));
  });

  it('no suggestion when nothing is close; Clear resets search AND filters', async () => {
    renderPanel();
    fireEvent.click(statusChip('Blocked'));
    fireEvent.change(searchBox(), { target: { value: 'qqqqzzzz' } });
    const empty = await screen.findByTestId('no-results');
    expect(within(empty).queryByText(/Did you mean/)).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    expect(statusChip('Blocked').getAttribute('aria-pressed')).toBe('false');
  });
});
