import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 010Fixes (owner, 2026-11-16, after the first class with admission numbers):
 *   01  registration still works when the page's switches are a few minutes
 *       old: the server asks for the code first, the page goes there (no
 *       "refresh", no error toast);
 *   03  a locked code and the hourly cap say what to do (ask the teacher);
 *   04  the code screen says exactly where the code went, "Didn't get it? Ask
 *       your teacher" in plain sight, and (with the fix on) "change to your
 *       real number, the one you'll use from now on".
 */

const ON = { 'checkin.admissionNumbers': true, 'student.fixNumber': true };
const refusal = (code, message, status = 409, extra = {}) => Object.assign(new Error(message), { name: 'ApiError', code, status, ...extra });
const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const type = async (label, value) => { await act(async () => { fireEvent.change(await screen.findByLabelText(label), { target: { value } }); }); };
const probeCard = ({ submit, notice }) => (
  <div data-testid="card">
    {notice?.text && <p data-testid="notice">{notice.text}</p>}
    <button type="button" onClick={submit}>Check in</button>
  </div>
);

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

describe('01 registration with out-of-date switches', () => {
  it('the server asks for the code first: the page goes to the code step, then registers with the ticket; no toast', async () => {
    const register = vi.fn()
      .mockRejectedValueOnce(refusal('refresh_needed', 'This page is out of date. Close it, then open the class link again and register.', 400))
      .mockResolvedValue({ ok: true, next: 'checkin', student: pending });
    const { api, toast, typed } = await renderSessionPage({
      checkinCard: probeCard,
      flags: { 'checkin.admissionNumbers': true }, // the page doesn't know the fix is on
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.reg', next: 'register' }),
        registerStudentApi: register,
      },
    });
    await click('Check in');
    typed.regNumber = '5820';
    await click('Register');
    expect(await screen.findByTestId('code-step')).toBeTruthy();
    expect(api.requestCode).toHaveBeenCalledWith('evening', PHONE, 'register');
    await type('Code', '123456');
    await click('Confirm');
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls[1][0]).toMatchObject({ number: '5820', ticket: 'v1.reg' });
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(toast.showError).not.toHaveBeenCalled();
  });
});

// 014Fixes / 04: "Confirm your phone" first (where the code goes, keep it
// near), sent on Send code; then the code screen and its help.
describe('04 the code screen', () => {
  it('where the code goes; after Send code, "Didn\'t get it?" and the teacher', async () => {
    await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.')) },
    });
    await click('Check in');
    expect((await screen.findByTestId('confirm-step')).textContent).toContain(PHONE.slice(-3));
    await click('Send code');
    await screen.findByTestId('code-step');
    const help = screen.getByTestId('code-help');
    expect(help.textContent).toBe("Didn't get it? Tap Send again when the countdown ends. Still nothing? Your teacher can see your code. Ask your teacher.");
  });
});

describe('03 no silent lockout', () => {
  it('a locked code says so, and the box is cleared', async () => {
    await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm.')),
        verifyCode: vi.fn().mockRejectedValue(refusal('too_many_tries', 'Too many wrong tries. Tap Send again for a new code, or ask your teacher to read you your code.', 400)),
      },
    });
    await click('Check in');
    await click('Send code');
    await type('Code', '123456');
    await click('Confirm');
    expect((await screen.findByRole('alert')).textContent).toBe('Too many wrong tries. Tap Send again for a new code, or ask your teacher to read you your code.');
    expect(screen.getByLabelText('Code').value).toBe('');
  });

  it('the hourly cap: ask the teacher; "Send again later", no long countdown', async () => {
    await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm.')),
        requestCode: vi.fn().mockRejectedValue(refusal('too_many_codes', 'Too many codes for this number this hour. Ask your teacher to read you your code.', 429, { retryAfter: 2900 })),
      },
    });
    await click('Check in');
    await click('Send code');
    expect((await screen.findByRole('alert')).textContent).toBe('Too many codes for this number this hour. Ask your teacher to read you your code.');
    const again = screen.getByRole('button', { name: 'Send again later' });
    expect(again.disabled).toBe(true);
    expect(screen.queryByText(/Send again in \d{3,} s/)).toBeNull();
  });
});
