import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';

/**
 * 001Fixes / 04 — the search box and class chips on the student list.
 *
 * Filters live in the URL (Back/Forward, bookmarks); the typed search text is
 * kept only in this tab's sessionStorage, which sign-out clears — it is
 * student names, and browser history would otherwise keep them.
 */

vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

const KEY = 'dashboard.studentSearch.v1';

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const at = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const kid = (id, studentName, cls, over = {}) => ({
  id, studentName, parentPhone: id, class: cls, subjects: 'English, Mathematics',
  receiptMessage: 'QAB123XYZ9 Confirmed', receiptStatus: 'pending', approvalStatus: 'approved',
  blocked: false, feeBalance: 0, registeredAt: at('2026-10-01T09:00:00+03:00'), ...over,
});
const roster = [
  kid('+254711000001', 'Amina Wanjiru', 'Form 3', { registeredAt: at('2026-10-05T10:00:00+03:00') }),
  kid('+254711000002', "Sean O'Brien", 'Grade 10', { registeredAt: at('2026-10-04T10:00:00+03:00') }),
  kid('+254711000003', 'Zoë Achieng', 'Grade 7', { registeredAt: at('2026-10-03T10:00:00+03:00') }),
  kid('+254722333444', 'Brian Otieno', 'Form 3', { registeredAt: at('2026-10-02T10:00:00+03:00') }),
  kid('+254733000005', 'Mercy Wambui', 'Grade 8', { registeredAt: at('2026-10-01T10:00:00+03:00') }),
];
const sessionDoc = { id: 'morning', name: 'Morning Session', classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'] };

let location;
function LocationProbe() {
  location = useLocation();
  return null;
}

async function renderPanel({ students = roster, entries = ['/dashboard'], session = 'morning', doc = sessionDoc } = {}) {
  const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
  const noop = vi.fn();
  const props = {
    session, sessionDoc: doc, students, loading: false,
    onDelete: noop, onEdit: noop, onExport: noop, onBlock: noop, onUnblock: noop, onApprove: noop, onDecline: noop,
  };
  const view = render(
    <MemoryRouter initialEntries={entries}>
      <StudentSearchPanel {...props} />
      <LocationProbe />
    </MemoryRouter>
  );
  const rerender = (over) => view.rerender(
    <MemoryRouter initialEntries={entries}>
      <StudentSearchPanel {...props} {...over} />
      <LocationProbe />
    </MemoryRouter>
  );
  return { ...view, rerender };
}

// The name cell also holds the avatar initial in a <strong class="text-primary">.
const rowNames = () => [...document.querySelectorAll('tr.student-row-wrapper td:nth-child(2) strong:not(.text-primary)')]
  .map((el) => el.textContent);
const searchBox = () => screen.getByRole('searchbox', { name: /Search students/ });
const chip = (label) => screen.getByRole('button', { name: new RegExp(`^${label}\\b`) });

// ---------------------------------------------------------------------------
describe('highlightMatches', () => {
  it('marks every term, ignoring case, accents and apostrophes; text stays text', async () => {
    const { highlightMatches } = await import('@features/dashboard/search/highlightMatches.jsx');
    const { container } = render(<p>{highlightMatches("Zoë O'Brien <img src=x>", ['zoe', 'obri', 'img'])}</p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Zoë', "O'Bri", 'img']);
    expect(container.querySelector('img')).toBeNull();
    expect(highlightMatches('plain', [])).toBe('plain');
  });

  it('merges overlapping matches into one mark', async () => {
    const { highlightMatches } = await import('@features/dashboard/search/highlightMatches.jsx');
    const { container } = render(<p>{highlightMatches('Wanjiru', ['wanj', 'njir'])}</p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Wanjir']);
  });

  it('derives terms from a query: words, short-form targets, class phrases, phone variants', async () => {
    const { highlightTerms } = await import('@features/dashboard/search/highlightMatches.jsx');
    const { parseQuery } = await import('@features/dashboard/search/studentSearch');
    expect(highlightTerms(parseQuery('amina f3 maths'))).toEqual(expect.arrayContaining(['amina', 'form 3', 'maths', 'mathematics']));
    expect(highlightTerms(parseQuery('0722333444'))).toEqual(expect.arrayContaining(['0722333444', '722333444']));
  });
});

// ---------------------------------------------------------------------------
describe('useStudentFilters: where the search state lives', () => {
  const wrapper = (entries) => ({ children }) => (
    <MemoryRouter initialEntries={entries}>{children}<LocationProbe /></MemoryRouter>
  );
  const load = async () => (await import('@features/dashboard/search/useStudentFilters.js')).useStudentFilters;

  it('reads filters from the URL', async () => {
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), {
      wrapper: wrapper(['/dashboard?class=Form%203&class=Grade%207&status=owes&sort=name&from=2026-10-01']),
    });
    expect(result.current.state).toMatchObject({ classes: ['Form 3', 'Grade 7'], statuses: ['owes'], sort: 'name', from: '2026-10-01' });
  });

  it('drops values it does not recognise', async () => {
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), {
      wrapper: wrapper(['/dashboard?status=nonsense&status=blocked&sort=bogus&from=garbage']),
    });
    expect(result.current.state).toMatchObject({ statuses: ['blocked'], sort: 'newest', from: null });
  });

  it('writes filters to the URL after a pause, replacing (no history spam); the typed text never goes in the URL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), { wrapper: wrapper(['/dashboard']) });
    act(() => { result.current.setQuery('amina'); result.current.toggleClass('Form 3'); });
    expect(location.search).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(location.search).toBe('?class=Form+3');
    expect(location.search).not.toMatch(/amina/);
    expect(JSON.parse(sessionStorage.getItem(KEY))).toMatchObject({ q: 'amina', classes: ['Form 3'] });
  });

  it('with no filters in the URL, restores the whole saved search for this tab', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ q: 'zoe', classes: ['Grade 7'], statuses: [], subjects: [], from: null, to: null, sort: 'oldest' }));
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), { wrapper: wrapper(['/dashboard']) });
    expect(result.current.state).toMatchObject({ q: 'zoe', classes: ['Grade 7'], sort: 'oldest' });
  });

  it('URL filters win over the saved ones; the saved typed text is kept', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ q: 'zoe', classes: ['Grade 7'], statuses: [], subjects: [], from: null, to: null, sort: 'oldest' }));
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), { wrapper: wrapper(['/dashboard?class=Form%203']) });
    expect(result.current.state).toMatchObject({ q: 'zoe', classes: ['Form 3'], sort: 'newest' });
  });

  it('Back/Forward (an outside URL change) is followed', async () => {
    const useStudentFilters = await load();
    let navigate;
    const { result } = renderHook(() => { navigate = useNavigate(); return useStudentFilters(); }, {
      wrapper: wrapper(['/dashboard?class=Grade%207']),
    });
    expect(result.current.state.classes).toEqual(['Grade 7']);
    act(() => navigate('/dashboard?class=Grade%208&status=blocked'));
    await waitFor(() => expect(result.current.state).toMatchObject({ classes: ['Grade 8'], statuses: ['blocked'] }));
  });

  it('clearAll empties the search and the filters but keeps the sort', async () => {
    const useStudentFilters = await load();
    const { result } = renderHook(() => useStudentFilters(), { wrapper: wrapper(['/dashboard?class=Form%203&sort=name&status=owes']) });
    act(() => { result.current.setQuery('x'); result.current.clearAll(); });
    expect(result.current.state).toMatchObject({ q: '', classes: [], statuses: [], subjects: [], from: null, to: null, sort: 'name' });
    expect(result.current.activeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('the search box and class chips', () => {
  it('typing filters the list and highlights the match', async () => {
    await renderPanel();
    expect(rowNames()).toHaveLength(5);
    fireEvent.change(searchBox(), { target: { value: 'zoe' } });
    await waitFor(() => expect(rowNames()).toEqual(['Zoë Achieng']));
    expect(document.querySelector('tr.student-row-wrapper mark').textContent).toBe('Zoë');
    expect(screen.getByTestId('search-summary').textContent).toMatch(/Showing 1 of 5/);
  });

  it('finds a parent by any form of the phone number', async () => {
    await renderPanel();
    fireEvent.change(searchBox(), { target: { value: '0722 333 444' } });
    await waitFor(() => expect(rowNames()).toEqual(['Brian Otieno']));
  });

  it('class chips show live counts, toggle (OR within classes), and show their state', async () => {
    await renderPanel();
    expect(chip('Form 3').textContent).toMatch(/2/);
    expect(chip('Grade 10').textContent).toMatch(/1/);
    fireEvent.click(chip('Form 3'));
    expect(chip('Form 3').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru', 'Brian Otieno']));
    fireEvent.click(chip('Grade 7'));
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru', 'Zoë Achieng', 'Brian Otieno']));
  });

  it('a chip with no students left is greyed, not hidden', async () => {
    await renderPanel();
    fireEvent.change(searchBox(), { target: { value: 'amina' } });
    await waitFor(() => expect(rowNames()).toEqual(['Amina Wanjiru']));
    expect(chip('Grade 8').className).toMatch(/is-empty/);
    expect(chip('Form 3').className).not.toMatch(/is-empty/);
  });

  it('active filters appear as removable chips; Clear all resets everything', async () => {
    await renderPanel();
    fireEvent.click(chip('Form 3'));
    fireEvent.change(searchBox(), { target: { value: 'brian' } });
    await waitFor(() => expect(rowNames()).toEqual(['Brian Otieno']));
    const summary = screen.getByTestId('search-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Remove filter Form 3' }));
    expect(chip('Form 3').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(summary).getByRole('button', { name: 'Clear all' }));
    expect(searchBox().value).toBe('');
    await waitFor(() => expect(rowNames()).toHaveLength(5));
  });

  it('nothing matching says so, with a way out', async () => {
    await renderPanel();
    fireEvent.change(searchBox(), { target: { value: 'nobody-here' } });
    await waitFor(() => expect(screen.getByTestId('no-results')).toBeTruthy());
    expect(screen.queryByText(/No students registered/)).toBeNull();
    fireEvent.click(within(screen.getByTestId('no-results')).getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
  });

  it('a session with no students keeps its "share the link" message and no search box', async () => {
    await renderPanel({ students: [] });
    expect(screen.getByText(/No students registered/)).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('the search carries over when the teacher switches session tab', async () => {
    const { rerender } = await renderPanel();
    fireEvent.change(searchBox(), { target: { value: 'otieno' } });
    await waitFor(() => expect(rowNames()).toEqual(['Brian Otieno']));
    rerender({ session: 'evening', students: [kid('+254744000001', 'Faith Otieno', 'Grade 8')] });
    await waitFor(() => expect(rowNames()).toEqual(['Faith Otieno']));
    expect(searchBox().value).toBe('otieno');
  });

  it('the footer counts what is shown out of the whole session', async () => {
    await renderPanel();
    fireEvent.click(chip('Form 3'));
    await waitFor(() => expect(screen.getByTestId('table-total').textContent).toMatch(/2 of 5/));
  });
});

// ---------------------------------------------------------------------------
describe('keyboard', () => {
  it('"/" and Ctrl+K focus the search; not while typing elsewhere', async () => {
    await renderPanel();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(searchBox());
    searchBox().blur();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(searchBox());
    const other = document.createElement('textarea');
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('Esc clears the search, a second Esc leaves the box; ↓ goes to the first result', async () => {
    await renderPanel();
    searchBox().focus();
    fireEvent.change(searchBox(), { target: { value: 'amina' } });
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(searchBox().value).toBe('');
    expect(document.activeElement).toBe(searchBox());
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(document.activeElement).not.toBe(searchBox());
    searchBox().focus();
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(document.querySelector('tr.student-row-wrapper'));
  });
});

// ---------------------------------------------------------------------------
describe('sign-out', () => {
  it('removes the saved search from this tab', async () => {
    vi.resetModules();
    sessionStorage.setItem(KEY, JSON.stringify({ q: 'amina' }));
    vi.doMock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: vi.fn(() => () => {}) }));
    vi.doMock('@services/firebase/auth', () => ({
      onAuthChange: vi.fn(() => () => {}), signIn: vi.fn(),
      signOut: vi.fn(async () => ({ success: true })),
    }));
    vi.doMock('@services/firebase/config', () => ({ auth: { currentUser: null }, db: {}, wipeLocalData: vi.fn(async () => {}) }));
    vi.doMock('@utils/analytics', () => ({ trackLogin: vi.fn() }));
    vi.doMock('@services/api/auth', () => ({ recordLoginAttempt: vi.fn() }));
    vi.doUnmock('@features/auth/context/AuthContext');
    const realLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, replace: vi.fn(), reload: vi.fn() } });
    try {
      const { AuthProvider, useAuthActions } = await import('@features/auth/context/AuthContext.jsx');
      const { result } = renderHook(() => useAuthActions(), { wrapper: AuthProvider });
      await act(async () => { await result.current.signOut({ redirectTo: '/' }); });
      expect(sessionStorage.getItem(KEY)).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
      for (const m of ['firebase/firestore', '@services/firebase/auth', '@services/firebase/config', '@utils/analytics', '@services/api/auth']) vi.doUnmock(m);
    }
  });
});
