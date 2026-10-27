import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import {
  renderSessionPage, unmockSessionPage, deferred, sentPhones, PHONE, OTHER_PHONE,
} from './sessionPageHarness';

/**
 * 002Fixes / 03 — the check-in race (Sentry ONLINE-TUTORING-1-2).
 *
 * 26 Oct, reconstructed from Cloudflare's logs: a waiting student tapped
 * "Check again", then "Use a different number" while the reply was in flight.
 * The late reply put the waiting screen back with the number cleared, and
 * every later "Check again" sent phone "" — five refusals in 24 seconds.
 *
 * These drive the REAL SessionPage and useRegistration with a slow network.
 */

const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false };
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const otherApproved = { studentName: 'Brian', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const blocked = { studentName: 'Amina', approvalStatus: 'approved', blocked: true, feeBalance: 700 };

const click = async (name) => {
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); });
};
const isUsable = (p) => /^\+[1-9]\d{7,18}$/.test(p);

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); vi.useRealTimers(); });

describe('the 26 Oct sequence', () => {
  it('"Use a different number" during a "Check again" wins; the late reply is dropped and no empty number is ever sent', async () => {
    const slow = deferred();
    const { api } = await renderSessionPage({
      api: {
        checkinStudent: vi.fn()
          .mockResolvedValueOnce({ exists: true, student: pending }) // the check-in
          .mockReturnValueOnce(slow.promise) // "Check again", slow
          .mockResolvedValue({ exists: true, student: pending }),
      },
    });

    await click('Check in');
    expect(screen.getByTestId('pending')).toBeTruthy();
    await click('Check again');
    await click('Use a different number');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();

    // The slow reply lands after the student has left.
    await act(async () => { slow.resolve({ exists: true, student: pending }); });

    // Still on the check-in card — not sent back to the waiting screen.
    expect(screen.queryByTestId('pending')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();

    // And if a "Check again" could still be pressed, it never sends "".
    const again = screen.queryByRole('button', { name: 'Check again' });
    if (again) await act(async () => { fireEvent.click(again); });
    expect(sentPhones(api).every(isUsable)).toBe(true);
    expect(sentPhones(api)).toEqual([PHONE, PHONE]);
  });

  it('a failed "Check again" that lands after the student left shows no error toast', async () => {
    const slow = deferred();
    const { toast } = await renderSessionPage({
      api: {
        checkinStudent: vi.fn()
          .mockResolvedValueOnce({ exists: true, student: pending })
          .mockReturnValueOnce(slow.promise),
      },
    });
    await click('Check in');
    await click('Check again');
    await click('Use a different number');
    await act(async () => { slow.reject(Object.assign(new Error('The request timed out.'), { name: 'ApiError', code: 'timeout' })); });
    expect(toast.showError).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });
});

describe('a stale reply never overwrites a newer student', () => {
  it('back, then a different number: the old number\'s late reply does not replace the new one', async () => {
    const slowA = deferred();
    const { typed } = await renderSessionPage({
      api: {
        checkinStudent: vi.fn(async (_s, phone) => (phone === PHONE ? { exists: true, student: pending } : { exists: true, student: otherApproved }))
          .mockResolvedValueOnce({ exists: true, student: pending })
          .mockReturnValueOnce(slowA.promise),
      },
    });
    await click('Check in'); // A → pending
    await click('Check again'); // A again, slow
    await click('Use a different number');
    typed.phone = OTHER_PHONE;
    await click('Check in'); // B → welcome
    expect(screen.getByTestId('welcome-name').textContent).toBe('Brian');

    await act(async () => { slowA.resolve({ exists: true, student: approved }); });
    expect(screen.getByTestId('welcome-name').textContent).toBe('Brian');
  });
});

describe('the paid re-check loop', () => {
  it('stops when the student backs out during its wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: blocked }) },
    });
    await click('Check in');
    await click('Simulate M-Pesa success');
    await click('Use a different number');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    // Only the original check-in: the loop never ran a re-check.
    expect(api.checkinStudent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });
});

describe('no usable number is never sent', () => {
  it('check-in with an empty number sends nothing and stays on the check-in card', async () => {
    const monitoring = await import('@utils/monitoring');
    const captureException = vi.fn();
    monitoring.__setSentryForTest({ captureException, addBreadcrumb: vi.fn() });
    const { api, toast, typed } = await renderSessionPage();
    typed.phone = '';
    await click('Check in');
    expect(api.checkinStudent).not.toHaveBeenCalled();
    expect(toast.showError).toHaveBeenCalledWith('Please enter your phone number again.');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(captureException.mock.calls[0][0]).toMatchObject({ code: 'client_empty_phone', path: '/api/student/checkin' });
    expect(captureException.mock.calls[0][1]).toMatchObject({ level: 'warning' });
    monitoring.__setSentryForTest(null);
  });
});

describe('ordinary flows are unchanged', () => {
  it('new student: register → waiting → "Check again" after approval → welcome → join opens class', async () => {
    const { api } = await renderSessionPage({
      api: {
        checkinStudent: vi.fn()
          .mockResolvedValueOnce({ exists: false, student: null })
          .mockResolvedValue({ exists: true, student: approved }),
      },
    });
    await click('Check in');
    await click('Register');
    expect(api.registerStudentApi).toHaveBeenCalledWith(expect.objectContaining({ session: 'evening', phone: PHONE }));
    expect(screen.getByTestId('pending')).toBeTruthy();
    await click('Check again');
    expect(screen.getByTestId('welcome-name').textContent).toBe('Amina');
    await click('Join now');
    // 002Fixes / 07 added a third argument, the check-in pass (none issued here).
    expect(api.getClassLink).toHaveBeenCalledWith('evening', PHONE, undefined);
    expect(screen.getByTestId('to-class')).toBeTruthy();
    expect(sentPhones(api)).toEqual([PHONE, PHONE]);
  });

  it('back from the registration form returns to an empty check-in card', async () => {
    const { api } = await renderSessionPage();
    await click('Check in');
    await click('Back');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(api.registerStudentApi).not.toHaveBeenCalled();
  });
});
