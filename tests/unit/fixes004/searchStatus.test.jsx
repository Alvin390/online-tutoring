import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { STATUS_KEYS, SORTS } from '@features/dashboard/search/studentSearch';
import { sanitizeSearch, filtersFromParams, STUDENT_SEARCH_STORAGE_KEY } from '@features/dashboard/search/searchState';
import { useStudentFilters } from '@features/dashboard/search/useStudentFilters';

/**
 * 004Fixes / 01 — the status filters "Block scheduled" and "Possible duplicate"
 * survive the URL / saved-search round trip (they were dropped on reading back).
 *
 * Every test asserts the CORRECT behaviour; a failure is the bug. The
 * "control" tests use a status that works today, to prove the harness itself
 * is sound.
 */

vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the sanitiser accepts every status the chips offer', () => {
  for (const key of STATUS_KEYS) {
    it(`keeps "${key}"`, () => {
      expect(sanitizeSearch({ statuses: [key] }).statuses).toEqual([key]);
    });
  }

  it('reads ?status=scheduled&status=duplicate from the URL', () => {
    expect(filtersFromParams(new URLSearchParams('status=scheduled&status=duplicate')).statuses)
      .toEqual(['scheduled', 'duplicate']);
  });

  // The sort list was copied the same way; one source now for both.
  for (const sort of SORTS) {
    it(`keeps sort "${sort}"`, () => {
      expect(sanitizeSearch({ sort }).sort).toBe(sort);
    });
  }

  it('CONTROL: ?status=blocked&status=owes is read', () => {
    expect(filtersFromParams(new URLSearchParams('status=blocked&status=owes')).statuses).toEqual(['blocked', 'owes']);
  });
});

let location;
const Probe = () => { location = useLocation(); return null; };
const wrapper = (entries) => ({ children }) => <MemoryRouter initialEntries={entries}>{children}<Probe /></MemoryRouter>;

describe('useStudentFilters: a status chip survives leaving and coming back', () => {
  async function toggleThenRemount(status) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = renderHook(() => useStudentFilters(), { wrapper: wrapper(['/dashboard']) });
    act(() => first.result.current.toggleStatus(status));
    expect(first.result.current.state.statuses).toEqual([status]); // works in memory
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    const url = `/dashboard${location.search}`;
    const saved = JSON.parse(sessionStorage.getItem(STUDENT_SEARCH_STORAGE_KEY));
    first.unmount();
    // A reload, a bookmark, or going to Billing and back: a fresh mount.
    const again = renderHook(() => useStudentFilters(), { wrapper: wrapper([url]) });
    return { url, saved, state: again.result.current.state };
  }

  it('CONTROL: "blocked" survives', async () => {
    const { url, state } = await toggleThenRemount('blocked');
    expect(url).toBe('/dashboard?status=blocked');
    expect(state.statuses).toEqual(['blocked']);
  });

  it('"scheduled" survives', async () => {
    const { url, saved, state } = await toggleThenRemount('scheduled');
    expect(url).toBe('/dashboard?status=scheduled'); // written correctly…
    expect(saved.statuses).toEqual(['scheduled']); // …and saved correctly…
    expect(state.statuses).toEqual(['scheduled']); // …but is it read back?
  });

  it('"duplicate" survives', async () => {
    const { state } = await toggleThenRemount('duplicate');
    expect(state.statuses).toEqual(['duplicate']);
  });
});

describe('through the real student list', () => {
  const at = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
  const kid = (n, over = {}) => ({
    id: `+2547110000${n}`, parentPhone: `+2547110000${n}`, studentName: `Student ${n}`, class: 'Form 3', subjects: 'English',
    receiptMessage: `R${n}ABCDEFGH ok`, receiptStatus: 'approved', approvalStatus: 'approved', blocked: false, feeBalance: 0,
    registeredAt: at(Date.parse('2026-10-01T09:00:00Z') - n * 60_000), ...over,
  });
  const roster = [
    kid(1, { scheduledBlock: { atMs: Date.now() + 86_400_000, batchId: 'S1', kind: 'other', reason: '' } }),
    kid(2, { scheduledBlock: { atMs: Date.now() + 86_400_000, batchId: 'S1', kind: 'other', reason: '' } }),
    kid(3), kid(4), kid(5),
  ];
  async function renderList(entries) {
    const { default: StudentSearchPanel } = await import('@features/dashboard/components/StudentSearchPanel.jsx');
    const noop = vi.fn();
    return render(
      <MemoryRouter initialEntries={entries}>
        <StudentSearchPanel session="morning" sessionDoc={{ id: 'morning', name: 'Morning', classes: ['Form 3'] }} students={roster} loading={false}
          onDelete={noop} onEdit={noop} onExport={noop} onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
        <Probe />
      </MemoryRouter>
    );
  }
  const rows = () => document.querySelectorAll('tr.student-row-wrapper').length;
  const chip = () => within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /^Block scheduled\b/ });

  it('opening the dashboard with ?status=scheduled shows the 2 scheduled students', async () => {
    await renderList(['/dashboard?status=scheduled']);
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toBe(2);
  });

  it('CONTROL: ticking the chip in place filters to 2', async () => {
    await renderList(['/dashboard']);
    fireEvent.click(chip());
    await waitFor(() => expect(rows()).toBe(2));
  });
});
