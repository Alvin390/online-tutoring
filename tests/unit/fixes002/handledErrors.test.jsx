import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage } from './sessionPageHarness';

/**
 * 002Fixes / 05 — through the real SessionPage and hook: every failure is
 * caught and reported on purpose; a 429 starts a visible wait with the
 * server's real time; joining never loops and never strands the student on a
 * spinner.
 */

const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false };
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const apiError = (code, status, extra = {}) => Object.assign(new Error(`${code}`), { name: 'ApiError', code, status, ...extra });

let captureException;
let unhandled;
const onUnhandled = (reason) => unhandled.push(reason);

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  const monitoring = await import('@utils/monitoring');
  captureException = vi.fn();
  monitoring.__setSentryForTest({ captureException, addBreadcrumb: vi.fn() });
});
afterEach(async () => {
  process.off('unhandledRejection', onUnhandled);
  (await import('@utils/monitoring')).__setSentryForTest(null);
  cleanup();
  unmockSessionPage();
  vi.useRealTimers();
});

const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const flush = () => act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });

describe('failures are handled and reported', () => {
  it('a check-in that cannot reach the server: no unhandled rejection, still on the check-in card, reported as a warning', async () => {
    await renderSessionPage({ api: { checkinStudent: vi.fn().mockRejectedValue(apiError('network_error', 0)) } });
    await click('Check in');
    await flush();
    expect(unhandled).toEqual([]);
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ code: 'network_error' }), {
      level: 'warning', tags: { flow_action: 'checkin', flow_screen: 'checkin' },
    });
  });

  it('"Check again" timing out keeps the student on the waiting screen', async () => {
    await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValueOnce({ exists: true, student: pending }).mockRejectedValue(apiError('timeout', 0)) },
    });
    await click('Check in');
    await click('Check again');
    await flush();
    expect(unhandled).toEqual([]);
    expect(screen.getByTestId('pending')).toBeTruthy();
    expect(captureException.mock.calls.at(-1)[1].tags).toEqual({ flow_action: 'refresh', flow_screen: 'pending' });
  });
});

describe('a 429 starts a real wait', () => {
  it('"Check again" refused for 12 minutes: the notice says so, the button rests, no "wait a moment" toast', async () => {
    const { toast } = await renderSessionPage({
      real: ['PendingApprovalScreen'],
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: true, student: pending })
          .mockRejectedValue(apiError('rate_limited', 429, { retryAfter: 720, message: 'Too many requests. Please wait a moment and try again.' })),
      },
    });
    await click('Check in');
    await click(/Check again/);
    await flush();
    expect(screen.getByTestId('retry-wait').textContent).toMatch(/12 minutes/);
    expect(screen.getByRole('button', { name: /Check again/ })).toBeDisabled();
    expect(toast.showError).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it('the wait survives a reload of the page', async () => {
    await renderSessionPage({
      api: { checkinStudent: vi.fn().mockRejectedValue(apiError('rate_limited', 429, { retryAfter: 600 })) },
    });
    await click('Check in');
    await flush();
    expect(screen.getByTestId('retry-wait')).toBeTruthy();
    cleanup();
    unmockSessionPage();
    vi.resetModules();
    await renderSessionPage();
    expect(screen.getByTestId('retry-wait').textContent).toMatch(/10 minutes/);
  });
});

describe('joining', () => {
  it('a class-link 429 lands on the welcome card with the wait — and the card does not count down into another try', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = await renderSessionPage({
      real: ['WelcomeBackCard'],
      api: {
        checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: approved }),
        getClassLink: vi.fn().mockRejectedValue(apiError('rate_limited', 429, { retryAfter: 300 })),
      },
    });
    await click('Check in');
    // The welcome card's own 3-second countdown joins once…
    for (let i = 0; i < 5; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.getClassLink).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Welcome Back/)).toBeTruthy();
    expect(screen.getByTestId('retry-wait').textContent).toMatch(/5 minutes/);
    expect(screen.getByRole('button', { name: /Join Class Now/ })).toBeDisabled();
    // …and never again by itself.
    for (let i = 0; i < 20; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.getClassLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Redirecting you to class in/)).toBeNull();
  });

  it('a refused link whose re-check also fails goes back to the welcome card, not a spinner', async () => {
    await renderSessionPage({
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: true, student: approved }).mockRejectedValue(apiError('network_error', 0)),
        getClassLink: vi.fn().mockRejectedValue(apiError('service_unavailable', 503)),
      },
    });
    await click('Check in');
    await click('Join now');
    await flush();
    expect(screen.getByTestId('welcome')).toBeTruthy();
    expect(screen.queryByTestId('to-class')).toBeNull();
    expect(unhandled).toEqual([]);
  });
});
