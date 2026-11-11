import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, render } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, deferred } from '../fixes002/sessionPageHarness';

/**
 * 007Fixes / 01: check-in on a weak connection (Sentry ONLINE-TUTORING-1-A, 1-9).
 *
 * At class start, students on weak mobile data hit the phone's 15 s limit even
 * though the server answered in about 1.5 s. Owner (2026-11-11): wait up to
 * 20 s, say "Still connecting…" after 6 s, retry once quietly (already so),
 * then "Your internet is slow. Tap Try again." on the student page only.
 */

const transient = (code) => Object.assign(new Error('The request timed out. Please check your connection.'), { name: 'ApiError', code, status: 0 });
const refused = (status, message) => Object.assign(new Error(message), { name: 'ApiError', code: 'refused', status });

/** A card that shows what the page tells it. */
const probeCard = ({ submit, slow, failedSlow }) => (
  <div>
    <button type="button" onClick={submit}>{failedSlow ? 'Try again' : 'Check in'}</button>
    {slow && <p data-testid="slow">slow</p>}
  </div>
);

const click = async (name) => {
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); });
};

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); vi.useRealTimers(); vi.doUnmock('@services/api/client'); });

describe('the requests', () => {
  it('check-in and the class link wait 20 s and retry once; other student calls keep the default', async () => {
    const apiPost = vi.fn().mockResolvedValue({});
    vi.doMock('@services/api/client', () => ({ apiPost, apiGet: vi.fn() }));
    const student = await import('@services/api/student');

    await student.checkinStudent('evening', '+254711000009');
    await student.getClassLink('evening', '+254711000009');
    await student.submitReceipt('evening', '+254711000009', 'QAB123XYZ9 Confirmed');

    const opts = Object.fromEntries(apiPost.mock.calls.map(([path, , o]) => [path, o ?? {}]));
    expect(opts['/api/student/checkin']).toMatchObject({ timeoutMs: 20_000, retry: 1 });
    expect(opts['/api/class/link']).toMatchObject({ timeoutMs: 20_000, retry: 1 });
    expect(opts['/api/student/receipt'].timeoutMs).toBeUndefined();
  });
});

describe('the check-in card on a slow network', () => {
  it('says "Still connecting…" after 6 s, and drops it when the reply arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const slow = deferred();
    await renderSessionPage({ checkinCard: probeCard, api: { checkinStudent: vi.fn().mockReturnValue(slow.promise) } });

    await click('Check in');
    act(() => { vi.advanceTimersByTime(5_900); });
    expect(screen.queryByTestId('slow')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByTestId('slow')).toBeTruthy();

    await act(async () => { slow.resolve({ exists: false, student: null }); });
    expect(screen.queryByTestId('slow')).toBeNull();
  });

  it('after the quiet retry also fails: "Your internet is slow. Tap Try again." and a Try again button that works', async () => {
    const { api, toast } = await renderSessionPage({
      checkinCard: probeCard,
      api: { checkinStudent: vi.fn().mockRejectedValueOnce(transient('timeout')).mockResolvedValue({ exists: false, student: null }) },
    });

    await click('Check in');
    expect(toast.showError).toHaveBeenCalledWith('Your internet is slow. Tap Try again.');
    expect(screen.queryByTestId('slow')).toBeNull();

    await click('Try again');
    expect(api.checkinStudent).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('register')).toBeTruthy();
  });

  it('a dropped connection gets the same plain words', async () => {
    const { toast } = await renderSessionPage({
      checkinCard: probeCard,
      api: { checkinStudent: vi.fn().mockRejectedValue(transient('network_error')) },
    });
    await click('Check in');
    expect(toast.showError).toHaveBeenCalledWith('Your internet is slow. Tap Try again.');
  });

  it('a refusal from the server still shows the server\'s own message, not the slow wording', async () => {
    const { toast } = await renderSessionPage({
      checkinCard: probeCard,
      api: { checkinStudent: vi.fn().mockRejectedValue(refused(403, 'This number is not allowed.')) },
    });
    await click('Check in');
    expect(toast.showError).toHaveBeenCalledWith('This number is not allowed.');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('leaving the flow while waiting clears the notice and drops the late reply', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const slow = deferred();
    const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false };
    await renderSessionPage({
      checkinCard: probeCard,
      api: { checkinStudent: vi.fn().mockResolvedValueOnce({ exists: true, student: pending }).mockReturnValueOnce(slow.promise) },
    });

    await click('Check in');
    await click('Check again');
    act(() => { vi.advanceTimersByTime(6_500); });
    await click('Use a different number');
    expect(screen.queryByTestId('slow')).toBeNull();

    await act(async () => { slow.resolve({ exists: true, student: pending }); });
    expect(screen.queryByTestId('pending')).toBeNull();
    expect(screen.queryByTestId('slow')).toBeNull();
  });
});

describe('the real screens', () => {
  it('CheckinCard shows the notice while slow, and "Try again" after a failure', async () => {
    const { default: CheckinCard } = await import('@/features/registration/components/CheckinCard');
    const { rerender } = render(<CheckinCard onSubmit={() => {}} loading slow />);
    expect(screen.getByText(/Still connecting… your network seems slow/)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();

    rerender(<CheckinCard onSubmit={() => {}} loading={false} failedSlow />);
    expect(screen.queryByText(/Still connecting/)).toBeNull();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });

  it('the join spinner (SuccessScreen) shows the notice while slow', async () => {
    const { default: SuccessScreen } = await import('@/features/registration/components/SuccessScreen');
    render(<SuccessScreen slow />);
    expect(screen.getByText(/Still connecting… your network seems slow/)).toBeTruthy();
  });
});

describe('the error report', () => {
  it('tags slow_notice: shown when the student saw "Still connecting…" before the failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const slow = deferred();
    await renderSessionPage({ checkinCard: probeCard, api: { checkinStudent: vi.fn().mockReturnValue(slow.promise) } });
    await click('Check in');
    act(() => { vi.advanceTimersByTime(7_000); });
    const err = transient('timeout');
    await act(async () => { slow.reject(err); });
    expect(err.slowNotice).toBe(true);
  });

  it('reportApiFailure turns that into the tag, and adds nothing otherwise', async () => {
    const captureException = vi.fn();
    const monitoring = await import('@shared/utils/monitoring');
    monitoring.__setSentryForTest({ captureException });
    monitoring.reportApiFailure(Object.assign(transient('timeout'), { slowNotice: true }), { action: 'checkin', screen: 'checkin' });
    monitoring.reportApiFailure(transient('timeout'), { action: 'checkin', screen: 'checkin' });
    expect(captureException.mock.calls[0][1].tags).toMatchObject({ slow_notice: 'shown', flow_action: 'checkin' });
    expect(captureException.mock.calls[1][1].tags.slow_notice).toBeUndefined();
    monitoring.__setSentryForTest(null);
  });
});
