import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * 007Fixes / 04: the phone bottom bar (owner, 2026-11-11): Students,
 * Approvals, Fees, WhatsApp, More ▸ Calendar / Setup / Billing (+ Help,
 * Logout). A tab whose flag is off drops out and the next moves in. One
 * stacking rule at the bottom of a phone: bar, then the selection bar above
 * it, then toasts above both; and a toast no longer pauses on a touch
 * screen's sticky "hover" (the 006Fixes finding).
 */

let flags;
let signOut;
let loc;
function Probe() { loc = useLocation(); return null; }

async function renderBar(path = '/dashboard/students') {
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));
  vi.doMock('@features/reports/components/HelpFeedbackModal', () => ({ default: () => <div role="dialog">help form</div> }));
  const { default: BottomNav } = await import('@features/dashboard/nav/BottomNav');
  const { visibleTabs } = await import('@features/dashboard/nav/dashboardTabs');
  const tabs = visibleTabs((f) => flags[f] === true);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Routes>
        <Route path="/dashboard/*" element={<BottomNav tabs={tabs} waitingCount={3} onLogout={signOut} />} />
        <Route path="/billing" element={<div>billing page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
const bar = () => screen.getByRole('navigation', { name: 'Dashboard sections' });
const labels = () => within(bar()).getAllByRole('link').map((a) => a.getAttribute('data-tab'))
  .concat(within(bar()).queryAllByRole('button', { name: /More/ }).map(() => 'more'));

beforeEach(() => {
  vi.resetModules();
  document.body.className = '';
  signOut = vi.fn();
  flags = { 'registration.requireApproval': true, 'fees.enabled': true, 'whatsapp.broadcast': true, 'calendar.enabled': true };
});
afterEach(() => { cleanup(); vi.doUnmock('@shared/config/FlagsContext'); document.body.className = ''; });

describe('the bar', () => {
  it('shows Students, Approvals (with the count), Fees, WhatsApp and More', async () => {
    await renderBar();
    expect(labels()).toEqual(['students', 'approvals', 'fees', 'whatsapp', 'more']);
    expect(within(bar()).getByRole('link', { name: /Approvals/ }).textContent).toMatch(/3/);
    expect(within(bar()).getByRole('link', { name: /Students/ }).getAttribute('aria-current')).toBe('page');
  });

  it('More lists Calendar, Setup, Billing, Help & feedback and Logout, and each works', async () => {
    await renderBar();
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: /More/ })); });
    const sheet = screen.getByRole('dialog', { name: 'More' });
    const items = within(sheet).getAllByRole('button').concat(within(sheet).getAllByRole('link'))
      .map((el) => el.textContent.trim()).filter((t) => t && t !== 'Close');
    expect(items.sort()).toEqual(['Billing', 'Calendar', 'Help & feedback', 'Logout', 'Setup', 'Staff'].sort()); // 007Fixes / 10

    await act(async () => { fireEvent.click(within(sheet).getByRole('link', { name: /Calendar/ })); });
    expect(loc.pathname).toBe('/dashboard/calendar');
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    expect(within(bar()).getByRole('button', { name: /More/ }).className).toMatch(/active/);
  });

  it('a hidden tab drops out and the next one moves in', async () => {
    flags['registration.requireApproval'] = false;
    await renderBar();
    // 007Fixes / 10: Staff (always shown) moves into the bar.
    expect(labels()).toEqual(['students', 'fees', 'whatsapp', 'staff', 'more']);
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: /More/ })); });
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).queryByRole('link', { name: /Staff/ })).toBeNull();
    expect(within(sheet).getByRole('link', { name: /Calendar/ })).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: /Setup/ })).toBeTruthy();
  });

  it('Billing opens the billing page; Logout signs out', async () => {
    await renderBar();
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: /More/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Logout/ })); });
    expect(signOut).toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(bar()).getByRole('button', { name: /More/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Billing/ })); });
    expect(await screen.findByText('billing page')).toBeTruthy();
  });
});

describe('the bottom of a phone screen', () => {
  it('the bar marks the page (has-bottom-nav), so content, selection bar and toasts sit above it', async () => {
    await renderBar();
    expect(document.body.classList.contains('has-bottom-nav')).toBe(true);
    cleanup();
    expect(document.body.classList.contains('has-bottom-nav')).toBe(false);
  });

  it('typing in a field hides the bar (is-typing), and leaving the field shows it again', async () => {
    await renderBar();
    const input = document.createElement('input');
    input.type = 'search';
    document.body.appendChild(input);
    act(() => { input.focus(); fireEvent.focusIn(input); });
    expect(document.body.classList.contains('is-typing')).toBe(true);
    act(() => { input.blur(); fireEvent.focusOut(input); });
    expect(document.body.classList.contains('is-typing')).toBe(false);
    input.remove();
  });

  it('the stacking rule is written once, as variables', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/dashboard.css', 'utf8') + readFileSync('src/styles/index.css', 'utf8');
    expect(css).toMatch(/--bottom-nav-h:/);
    expect(css).toMatch(/body\.has-bottom-nav \.selection-bar\s*\{[^}]*bottom:\s*calc\(var\(--bottom-nav-h\)/);
    expect(css).toMatch(/body\.has-bottom-nav \.toast-container\s*\{[^}]*var\(--bottom-nav-h\)/);
    expect(css).toMatch(/body\.has-bottom-nav\.has-selection-bar \.toast-container/);
  });
});

describe('toasts on a touch screen', () => {
  it('do not pause on a sticky "hover" when the device cannot hover; still pause on hover with a mouse', async () => {
    vi.useFakeTimers();
    const run = async (canHover) => {
      vi.resetModules();
      const answer = (q) => (/hover: hover/.test(q) ? canHover : /hover: none/.test(q) ? !canHover : false);
      window.matchMedia = (q) => ({ matches: answer(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      const { default: Toast } = await import('@shared/components/ui/Toast');
      const onClose = vi.fn();
      const { unmount } = render(<Toast id="t1" type="success" message="Done" duration={4000} onClose={onClose} />);
      fireEvent.mouseEnter(screen.getByTestId('toast'));
      act(() => { vi.advanceTimersByTime(5000); });
      const closed = onClose.mock.calls.length > 0;
      unmount();
      return closed;
    };
    expect(await run(false)).toBe(true); // touch: the timer keeps running
    expect(await run(true)).toBe(false); // mouse: paused while hovered
    vi.useRealTimers();
  });
});
