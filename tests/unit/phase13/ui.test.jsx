import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Phase 13 / 07 — UI fixes. Each block inverts a validation check from
 * issues/validation/ui/findings.check.jsx: that suite proved the bug, this
 * one proves the fix.
 */

const ROOT = process.cwd();
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

beforeEach(() => vi.resetModules());
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
describe('D1 student popup is centred on every screen (I5)', () => {
  const student = { id: '+254712345678', studentName: 'Amina', parentPhone: '+254712345678', class: 'G8', subjects: 'Maths', receiptMessage: 'QAB' };
  const noop = () => {};

  async function openOnTouch() {
    window.ontouchstart = null; // StudentRow treats this as a touch device
    const { default: StudentRow } = await import('@/features/dashboard/components/StudentRow.jsx');
    const view = render(
      <table><tbody>
        <StudentRow student={student} index={0} session="morning" onDelete={noop} onEdit={noop}
          onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
      </tbody></table>
    );
    fireEvent.click(view.container.querySelector('tr'));
    const card = await waitFor(() => {
      const el = document.querySelector('.student-info-popup');
      if (!el) throw new Error('no popup');
      return el;
    });
    return { view, card };
  }

  afterEach(() => { delete window.ontouchstart; });

  it('the POSITIONING element is never animated: no inline transform on the layer', async () => {
    const { card } = await openOnTouch();
    const layer = card.parentElement;
    expect(layer.classList.contains('student-info-layer')).toBe(true);
    expect(layer.style.transform).toBe('');
    // The card may carry framer's scale; the stylesheet no longer centres it
    // with a transform for framer to overwrite.
    const css = read('src/styles/dashboard.css');
    const popupRules = [...css.matchAll(/\.student-info-popup\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(popupRules).not.toMatch(/\btransform\s*:/);
    expect(popupRules).not.toMatch(/\bleft\s*:/);
    expect(popupRules).not.toMatch(/min-width\s*:\s*90vw/);
    const layerRule = /\.student-info-layer\s*\{([^}]*)\}/.exec(css)[1];
    expect(layerRule).toMatch(/position:\s*fixed/);
    expect(layerRule).toMatch(/place-items:\s*center/);
  });

  it('fits a 375 px phone: the card is at most viewport − 32 px wide', () => {
    const css = read('src/styles/dashboard.css');
    expect(/\.student-info-popup\s*\{[^}]*width:\s*min\(500px,\s*calc\(100vw - 32px\)\)/.test(css)).toBe(true);
    expect(/\.student-info-popup\s*\{[^}]*max-height:\s*min\(85dvh,\s*720px\)/.test(css)).toBe(true);
  });

  it('scrollers contain their absolutely positioned children (the page never widens)', () => {
    const css = read('src/styles/dashboard.css');
    expect(/(^|\n)\.table-responsive\s*\{[^}]*position:\s*relative/.test(css)).toBe(true);
  });

  it('Escape closes it and focus goes back to the row', async () => {
    const { view, card } = await openOnTouch();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.student-info-popup')).toBeNull());
    expect(document.activeElement).toBe(view.container.querySelector('tr'));
  });

  it('guard: no motion.* element anywhere is centred with left:50% + translate', () => {
    const cssFiles = walk(path.join(ROOT, 'src'), ['.css']);
    const centred = new Set();
    for (const file of cssFiles) {
      for (const [, selector, body] of readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (/left:\s*50%/.test(body) && /transform:[^;]*translate\(-50%/.test(body)) {
          for (const [, cls] of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) centred.add(cls);
        }
      }
    }
    const offenders = [];
    for (const file of walk(path.join(ROOT, 'src'), ['.jsx'])) {
      const src = readFileSync(file, 'utf8');
      // `m.*` since Phase 13 / 08 A4 (LazyMotion); `motion.*` checked too.
      for (const [tag] of src.matchAll(/<(?:motion|m)\.[a-z]+\b[^>]*>/gs)) {
        const cls = /className="([^"]+)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
        for (const c of cls) if (centred.has(c)) offenders.push(`${path.relative(ROOT, file)}: .${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('D2 toasts (B-toast, S-toast-id)', () => {
  async function mount() {
    const mod = await import('@/context/ToastContext.jsx');
    let api;
    let consumerRenders = 0;
    const Probe = () => { api = mod.useToast(); consumerRenders += 1; return null; };
    const view = render(<mod.ToastProvider><Probe /></mod.ToastProvider>);
    return { api: () => api, renders: () => consumerRenders, view, mod };
  }

  it('uses only classes some loaded stylesheet defines, in a fixed container', async () => {
    const { api } = await mount();
    act(() => { api().showSuccess('Saved'); api().showError('Nope'); api().showWarning('Careful'); api().showInfo('FYI', 'Info', { action: { label: 'Undo', onClick: () => {} } }); });
    const css = [
      'src/styles/index.css', 'src/styles/dashboard.css', 'src/styles/animations.css',
      'node_modules/bootstrap/dist/css/bootstrap.css', 'node_modules/bootstrap-icons/font/bootstrap-icons.css',
    ].map((f) => read(f)).join('\n');
    const defined = (cls) => new RegExp(String.raw`\.${cls.replace(/[-/]/g, (m) => `\\${m}`)}(?![\w-])`).test(css);
    const container = screen.getByTestId('toast-container');
    const classes = new Set([container, ...container.querySelectorAll('*')].flatMap((el) => [...el.classList]));
    expect([...classes].filter((c) => !defined(c))).toEqual([]);
    expect(/\.toast-container\s*\{[^}]*position:\s*fixed/.test(read('src/styles/index.css'))).toBe(true);
  });

  it('two toasts in the same millisecond get distinct ids; dismissing one leaves the other', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { api } = await mount();
    act(() => { api().showSuccess('one'); api().showError('two'); });
    now.mockRestore();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    warn.mockRestore();
    expect(screen.getAllByTestId('toast')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Success' }));
    await waitFor(() => expect(screen.getAllByTestId('toast')).toHaveLength(1));
    expect(screen.getByText('two')).toBeInTheDocument();
  });

  it('shows at most 4, dropping the oldest', async () => {
    const { api } = await mount();
    act(() => { for (let i = 1; i <= 6; i += 1) api().showInfo(`m${i}`); });
    await waitFor(() => expect(screen.getAllByTestId('toast')).toHaveLength(4));
    expect(screen.queryByText('m1')).toBeNull();
    expect(screen.getByText('m6')).toBeInTheDocument();
  });

  it('errors interrupt (role=alert); others are polite status', async () => {
    const { api } = await mount();
    act(() => { api().showError('Bad'); api().showSuccess('Good'); });
    expect(screen.getByText('Bad').closest('[data-testid="toast"]')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Good').closest('[data-testid="toast"]')).toHaveAttribute('role', 'status');
  });

  it('an action button runs and dismisses', async () => {
    const { api } = await mount();
    const undo = vi.fn();
    act(() => { api().showSuccess('Note deleted', 'Deleted', { action: { label: 'Undo', onClick: undo }, duration: 8000 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Note deleted')).toBeNull());
  });

  it('firing a toast does not re-render the components that use useToast()', async () => {
    const { api, renders } = await mount();
    const before = renders();
    act(() => { api().showSuccess('one'); api().showInfo('two'); });
    expect(renders()).toBe(before);
  });

  // Last in this block: framer's frame loop keeps whichever timers were
  // installed when it first ran, so exit animations after this would stall.
  it('the timer pauses while hovered', async () => {
    vi.useFakeTimers();
    try {
      const { api } = await mount();
      act(() => { api().showSuccess('Hold on'); });
      act(() => { vi.advanceTimersByTime(3000); });
      const toast = screen.getByTestId('toast');
      fireEvent.mouseEnter(toast);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByText('Hold on')).toBeInTheDocument();
      fireEvent.mouseLeave(toast);
      act(() => { vi.advanceTimersByTime(2500); });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(screen.queryByText('Hold on')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
describe('D3 S-ics: recurring feed events keep their Nairobi weekday', () => {
  it('Monday 01:00 EAT weekly → DTSTART;TZID local, and every expansion is a Monday 01:00 EAT', async () => {
    const { buildIcs } = await import('../../../api/_lib/ics.js');
    const { RRule, rrulestr } = await import('rrule');
    const ics = buildIcs({
      events: [{
        id: 'mon', title: 'Early maths',
        start: new Date('2026-10-04T22:00:00Z'), // Mon 5 Oct 01:00 EAT
        end: new Date('2026-10-04T23:00:00Z'),
        recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: null },
        recurrenceExceptions: [],
      }],
    });
    expect(ics).toContain('DTSTART;TZID=Africa/Nairobi:20261005T010000');
    expect(ics).toContain('DTEND;TZID=Africa/Nairobi:20261005T020000');
    expect(ics).not.toMatch(/DTSTART:20261004T220000Z/);

    // Expand what a client would: the RRULE applied to the WALL-CLOCK DTSTART
    // in its TZID. Expanded as a floating time (no TZID, no Z), rrule keeps the
    // wall clock in the Date's UTC fields whatever the machine's time zone.
    // (With TZID=, rrule's output depends on the host zone: CI runs in UTC.)
    const dtstart = /DTSTART;TZID=Africa\/Nairobi:(\d{8}T\d{6})/.exec(ics)[1];
    const rule = /RRULE:(.*)/.exec(ics)[1].trim();
    const set = rrulestr(`DTSTART:${dtstart}\nRRULE:${rule};COUNT=6`);
    const dates = set.all();
    expect(dates).toHaveLength(6);
    for (const d of dates) {
      const local = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(d);
      expect(local).toBe('Mon 01:00');
    }
    expect(RRule).toBeTruthy();
  });

  it('the old UTC form would have repeated on Sunday 22:00 UTC (= the bug)', async () => {
    const { rrulestr } = await import('rrule');
    const dates = rrulestr('DTSTART:20261004T220000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2').all();
    const local = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Africa/Nairobi' }).format(dates[0]);
    expect(local).toBe('Tue');
  });
});

// ---------------------------------------------------------------------------
describe('D3 S-cal-stale: paging back shows the right month, from cache', () => {
  it('Oct → Nov → Oct shows October and makes no third fetch', async () => {
    const getCalendarEvents = vi.fn(async ({ from, to }) => {
      const mid = new Date((new Date(from).getTime() + new Date(to).getTime()) / 2);
      const isOct = mid.getUTCMonth() === 9;
      return {
        calendarEnabled: true,
        events: [isOct
          ? { id: 'oct', title: 'Oct test', start: '2026-10-14T05:00:00.000Z', end: '2026-10-14T06:00:00.000Z', recurrence: null }
          : { id: 'nov', title: 'Nov test', start: '2026-11-18T05:00:00.000Z', end: '2026-11-18T06:00:00.000Z', recurrence: null }],
      };
    });
    vi.doMock('@services/api/calendar', () => ({ getCalendarEvents, manageCalendarEvent: vi.fn().mockResolvedValue({ ok: true }) }));
    vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
    const { useCalendar } = await import('@/features/calendar/hooks/useCalendar.js');

    const { result } = renderHook(() => useCalendar({ enabled: true }));
    act(() => result.current.setMonth(new Date(2026, 9, 1)));
    await waitFor(() => expect(result.current.events[0]?.id).toBe('oct'));
    act(() => result.current.goToNextMonth());
    await waitFor(() => expect(result.current.events[0]?.id).toBe('nov'));
    const fetchesBefore = getCalendarEvents.mock.calls.length;
    act(() => result.current.goToPreviousMonth());
    expect(result.current.events.map((e) => e.id)).toEqual(['oct']);
    await new Promise((r) => setTimeout(r, 30));
    expect(getCalendarEvents.mock.calls.length).toBe(fetchesBefore);

    // A mutation invalidates the cache: the current window refetches.
    await act(async () => { await result.current.updateEvent({ id: 'oct', title: 'Renamed' }); });
    expect(getCalendarEvents.mock.calls.length).toBe(fetchesBefore + 1);
    vi.doUnmock('@services/api/calendar');
    vi.doUnmock('@/context/ToastContext');
  });
});

// ---------------------------------------------------------------------------
describe('D4 deleted notes can be restored (S-notes)', () => {
  it('"Recently deleted" lists the soft-deleted note, and Restore brings it back', async () => {
    const restoreNote = vi.fn().mockResolvedValue({ success: true });
    vi.doMock('@features/notes/hooks/useStudentNotes', () => ({
      RECOVERY_WINDOW_DAYS: 30,
      useStudentNotes: () => ({
        notes: [], knownTags: [], loading: false, saving: false,
        addNote: vi.fn(), editNote: vi.fn(), deleteNote: vi.fn(), restoreNote,
        deletedNotes: [{ id: 'n1', body: 'Spoke to mum about fees', deletedAt: { toMillis: () => Date.now() - 3 * 86_400_000 } }],
      }),
    }));
    const { default: NotesTab } = await import('@features/notes/components/NotesTab.jsx');
    render(<NotesTab session="morning" phone="+254712345678" studentName="Amina" active />);
    const section = screen.getByTestId('deleted-notes');
    expect(section).toHaveTextContent('Recently deleted (1)');
    expect(section).toHaveTextContent('Deleted 3 days ago');
    fireEvent.click(screen.getByRole('button', { name: /Restore note: Spoke to mum/ }));
    expect(restoreNote).toHaveBeenCalledWith('n1');
    vi.doUnmock('@features/notes/hooks/useStudentNotes');
  });

  it('the hook offers only notes inside the 30-day window, and deleting shows an 8-second Undo', async () => {
    const showSuccess = vi.fn();
    const updateDoc = vi.fn().mockResolvedValue(undefined);
    const day = 86_400_000;
    const docs = [
      { id: 'live', body: 'a', deletedAt: null },
      { id: 'd3', body: 'b', deletedAt: { toMillis: () => Date.now() - 3 * day } },
      { id: 'd40', body: 'c', deletedAt: { toMillis: () => Date.now() - 40 * day } },
    ];
    vi.doMock('firebase/firestore', () => ({
      collection: vi.fn(() => ({})), doc: vi.fn((_db, p, id) => ({ path: `${p}/${id}` })),
      addDoc: vi.fn(), updateDoc, orderBy: vi.fn(), query: vi.fn(() => ({})), serverTimestamp: vi.fn(() => 'ts'),
      onSnapshot: vi.fn((_q, next) => { next({ forEach: (fn) => docs.forEach((d) => fn({ id: d.id, data: () => d })) }); return () => {}; }),
    }));
    vi.doMock('@services/firebase/config', () => ({ db: {} }));
    vi.doMock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ user: { uid: 't1' } }) }));
    vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess, showError: vi.fn() }) }));
    const { useStudentNotes } = await import('@features/notes/hooks/useStudentNotes.js');
    const { result } = renderHook(() => useStudentNotes({ session: 'morning', phone: '+254712345678', enabled: true }));

    expect(result.current.notes.map((n) => n.id)).toEqual(['live']);
    expect(result.current.deletedNotes.map((n) => n.id)).toEqual(['d3']);

    await act(async () => { await result.current.deleteNote('live'); });
    const [, title, options] = showSuccess.mock.calls.at(-1);
    expect(title).toBe('Note deleted');
    expect(options).toMatchObject({ duration: 8000, action: { label: 'Undo' } });
    await act(async () => { options.action.onClick(); });
    expect(updateDoc).toHaveBeenLastCalledWith(expect.anything(), { deletedAt: null });
    for (const m of ['firebase/firestore', '@services/firebase/config', '@features/auth/context/AuthContext', '@/context/ToastContext']) vi.doUnmock(m);
  });
});
