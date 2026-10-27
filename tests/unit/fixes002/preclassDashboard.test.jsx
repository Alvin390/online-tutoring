import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, renderHook } from '@testing-library/react';
import PendingApprovalsPanel, { relativeStart } from '@features/dashboard/components/PendingApprovalsPanel.jsx';
import { useWaitingTitle, PAGE_TITLE } from '@features/dashboard/hooks/useWaitingTitle';

/**
 * 002Fixes / 08 — approvals before class: a pre-class banner per session with
 * students waiting, its own Approve-all, and the waiting count in the tab title.
 */

const eat = (iso) => Date.parse(`${iso}+03:00`);
const sessions = [
  { id: 'morning', name: 'Morning Session', schedule: { days: [], tz: 'Africa/Nairobi', startTime: '08:30', endTime: '10:30' } },
  { id: 'evening', name: 'Evening Session', schedule: { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' } },
];
const student = (id, studentName, session) => ({ id, studentName, session, class: 'Form 3', subjects: 'English', parentPhone: id });
const eveningFour = ['Amina', 'Brian', 'Chebet', 'Dan'].map((n, i) => student(`+25471100000${i}`, n, 'evening'));

beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPanel = (pending, at) => {
  vi.setSystemTime(at);
  const onApprove = vi.fn().mockResolvedValue(undefined);
  render(<PendingApprovalsPanel pending={pending} sessions={sessions} onApprove={onApprove} onReject={vi.fn()} loading={false} />);
  return onApprove;
};
const banners = () => screen.queryAllByTestId('preclass-banner');

describe('the pre-class banner', () => {
  it('25 minutes before: names the class and the count, amber, with its own Approve all', () => {
    renderPanel(eveningFour, eat('2026-10-27T19:05'));
    expect(banners()).toHaveLength(1);
    expect(banners()[0].textContent).toMatch(/Evening Session class starts in 25 min — 4 students waiting\./);
    expect(banners()[0].className).toMatch(/alert-warning/);
    expect(within(banners()[0]).getByRole('button', { name: /Approve all 4/ })).toBeTruthy();
  });

  it('90 minutes before: blue, hours and minutes', () => {
    renderPanel(eveningFour, eat('2026-10-27T18:00'));
    expect(banners()[0].textContent).toMatch(/starts in 1 h 30 min/);
    expect(banners()[0].className).toMatch(/alert-info/);
  });

  it('more than two hours before: no banner (the list is still there)', () => {
    renderPanel(eveningFour, eat('2026-10-27T17:00'));
    expect(banners()).toHaveLength(0);
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
  });

  it('after the start: "started N min ago — still waiting"', () => {
    renderPanel(eveningFour, eat('2026-10-27T19:40'));
    expect(banners()[0].textContent).toMatch(/started 10 min ago — 4 students still waiting\./);
  });

  it('only sessions that have students waiting', () => {
    renderPanel([student('+254711000099', 'Zawadi', 'morning')], eat('2026-10-27T19:05'));
    expect(banners()).toHaveLength(0); // the morning class is not near; nobody waits for the evening
  });

  it('one student: the button names them', () => {
    renderPanel([eveningFour[0]], eat('2026-10-27T19:05'));
    expect(within(banners()[0]).getByRole('button', { name: /Approve Amina/ })).toBeTruthy();
  });

  it('Approve all from the banner confirms by name and approves only that session', async () => {
    const mixed = [...eveningFour, student('+254711000099', 'Zawadi', 'morning')];
    const onApprove = renderPanel(mixed, eat('2026-10-27T19:05'));
    fireEvent.click(within(banners()[0]).getByRole('button', { name: /Approve all 4/ }));
    expect(screen.getByText('Approve 4 students for Evening Session?')).toBeTruthy();
    const list = screen.getByText('Approve 4 students for Evening Session?').nextElementSibling;
    expect(list.textContent).toMatch(/Amina/);
    expect(list.textContent).not.toMatch(/Zawadi/);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve all' }));
    await vi.waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    expect(onApprove).toHaveBeenCalledWith('evening', eveningFour.map((s) => s.id));
  });

  it('the header\'s Approve all still covers every session (unchanged)', async () => {
    const mixed = [...eveningFour, student('+254711000099', 'Zawadi', 'morning')];
    const onApprove = renderPanel(mixed, eat('2026-10-27T12:00'));
    fireEvent.click(screen.getByRole('button', { name: /Approve all \(5\)/ }));
    expect(screen.getByText('Approve all 5 students?')).toBeTruthy();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve all' }));
    await vi.waitFor(() => expect(onApprove).toHaveBeenCalledTimes(2));
  });
});

describe('relativeStart', () => {
  it('never says "in 0 min" for a class about to start', () => {
    const t = eat('2026-10-27T19:30');
    expect(relativeStart(t, t - 20_000)).toBe('starts in 1 min');
    expect(relativeStart(t, t - 65 * 60_000)).toBe('starts in 1 h 05 min');
    expect(relativeStart(t, t + 3 * 60_000)).toBe('started 3 min ago');
  });
});

describe('the tab title', () => {
  it('shows the waiting count, and restores the title at 0 and on close', () => {
    const { rerender, unmount } = renderHook(({ n }) => useWaitingTitle(n), { initialProps: { n: 4 } });
    expect(document.title).toBe(`(4) ${PAGE_TITLE}`);
    rerender({ n: 0 });
    expect(document.title).toBe(PAGE_TITLE);
    rerender({ n: 2 });
    expect(document.title).toBe(`(2) ${PAGE_TITLE}`);
    unmount();
    expect(document.title).toBe(PAGE_TITLE);
  });
});
