import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import PendingApprovalScreen, { AUTO_CHECK_MS, AUTO_CHECK_MAX } from '@/features/registration/components/PendingApprovalScreen.jsx';
import RetryWaitNotice from '@/features/registration/components/RetryWaitNotice.jsx';

/**
 * 002Fixes / 05 — the waiting screen paces "Check again" and checks by itself;
 * a refusal says how long to wait.
 */

vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const button = () => screen.getByRole('button', { name: /Check again/ });
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const renderPending = (props = {}) => {
  const onRefresh = vi.fn();
  render(<PendingApprovalScreen session="evening" studentData={{ studentName: 'Amina' }} onRefresh={onRefresh} onBack={vi.fn()} loading={false} {...props} />);
  return onRefresh;
};

describe('"Check again" pacing', () => {
  it('rests 15 s, then 30 s, then 60 s, then 60 s, with a visible countdown', () => {
    // Page hidden: automatic checks stay off, so only the taps are measured.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const onRefresh = renderPending();
    for (const rest of [15, 30, 60, 60]) {
      fireEvent.click(button());
      expect(button()).toBeDisabled();
      expect(button().textContent).toMatch(new RegExp(`Check again in ${rest} s`));
      advance(rest * 1000 - 1000);
      expect(button()).toBeDisabled();
      advance(1000);
      expect(button()).not.toBeDisabled();
    }
    expect(onRefresh.mock.calls).toEqual([['manual'], ['manual'], ['manual'], ['manual']]);
    vi.restoreAllMocks();
  });

  it('two taps inside the rest send one check', () => {
    const onRefresh = renderPending();
    fireEvent.click(button());
    fireEvent.click(button());
    advance(5000);
    fireEvent.click(button());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('constant tapping for 10 minutes, with automatic checks on, sends at most 12 checks in all (limit: 20)', () => {
    const onRefresh = renderPending({});
    const btn = button(); // the same element throughout; only its state changes
    for (let s = 0; s < 600; s += 1) {
      if (!btn.disabled) fireEvent.click(btn);
      advance(1000);
    }
    expect(onRefresh.mock.calls.length).toBeLessThanOrEqual(12);
  }, 60_000);

  it('an automatic check makes the button rest too, so a tap cannot follow it at once', () => {
    const onRefresh = renderPending();
    advance(AUTO_CHECK_MS);
    expect(onRefresh).toHaveBeenCalledWith('auto');
    expect(button()).toBeDisabled();
  });

  it('a rate-limit wait disables it', () => {
    renderPending({ waitSeconds: 300 });
    expect(button()).toBeDisabled();
  });
});

describe('automatic checks', () => {
  it('every minute while visible, at most 10, then says it has stopped', () => {
    const onRefresh = renderPending();
    advance(AUTO_CHECK_MS - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    advance(1);
    expect(onRefresh).toHaveBeenCalledWith('auto');
    for (let i = 0; i < 20; i += 1) advance(AUTO_CHECK_MS);
    expect(onRefresh.mock.calls.filter(([src]) => src === 'auto')).toHaveLength(AUTO_CHECK_MAX);
    expect(screen.getByTestId('auto-check-note').textContent).toMatch(/Automatic checking has stopped/);
  });

  it('not while the page is hidden, during a check, or during a wait', () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const a = renderPending();
    for (let i = 0; i < 3; i += 1) advance(AUTO_CHECK_MS);
    expect(a).not.toHaveBeenCalled();
    hidden.mockRestore();
    cleanup();

    const b = renderPending({ loading: true });
    for (let i = 0; i < 2; i += 1) advance(AUTO_CHECK_MS);
    expect(b).not.toHaveBeenCalled();
    cleanup();

    const c = renderPending({ waitSeconds: 900 });
    for (let i = 0; i < 2; i += 1) advance(AUTO_CHECK_MS);
    expect(c).not.toHaveBeenCalled();
  });

  it('stops when the screen goes away', () => {
    const onRefresh = renderPending();
    cleanup();
    advance(AUTO_CHECK_MS * 3);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('waiting-screen copy', () => {
  it('names the class time and says they will be let in automatically; never claims the teacher was notified', () => {
    renderPending({ classTime: '7:30 PM' });
    const text = document.body.textContent;
    expect(text).toMatch(/Class starts at 7:30 PM/);
    expect(text).toMatch(/let in automatically once you’re approved — keep this page open/);
    expect(text).not.toMatch(/notified/i);
  });
});

describe('the wait notice', () => {
  it('minutes with the clock time, or seconds', () => {
    const until = Date.now() + 720_000;
    const { rerender } = render(<RetryWaitNotice secondsLeft={720} until={until} />);
    expect(screen.getByTestId('retry-wait').textContent).toMatch(/try again in 12 minutes \(at \d{1,2}:\d{2}/);
    rerender(<RetryWaitNotice secondsLeft={45} until={Date.now() + 45_000} />);
    expect(screen.getByTestId('retry-wait').textContent).toMatch(/try again in 45 seconds\./);
    rerender(<RetryWaitNotice secondsLeft={0} until={0} />);
    expect(screen.queryByTestId('retry-wait')).toBeNull();
  });
});
