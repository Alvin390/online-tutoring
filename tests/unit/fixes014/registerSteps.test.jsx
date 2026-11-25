import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, within, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderSessionPage, unmockSessionPage, PHONE, OTHER_PHONE } from '../fixes002/sessionPageHarness';

/**
 * 014Fixes / 06 — registering (owner rulings 9 and 10): the form (no number
 * box) → "Confirm your phone" (sent on Send code; or "That phone isn't near
 * me" with the pop-up first) → saved with the number the school gave → the
 * pop-up → class, or the waiting screen when approval is on.
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const pending = { studentName: 'New', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
const approved = { studentName: 'New', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const saved = (student = pending) => vi.fn().mockResolvedValue({
  ok: true, next: 'checkin', student, number: { kind: 'student', digits: '7319', display: '7319' },
});
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const enterCode = async () => {
  await act(async () => { fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } }); });
  await click('Confirm');
};

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

describe('form → code → saved with a given number → pop-up', { timeout: 20_000 }, () => {
  it('approval on: the code first, then saved, the number shown, then the waiting screen', async () => {
    const { api } = await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        registerStudentApi: saved(),
      },
    });
    await click('Check in');
    await click('Register');
    expect(api.registerStudentApi).not.toHaveBeenCalled(); // nothing saved before the code
    expect(await screen.findByTestId('confirm-step')).toBeTruthy();
    expect(api.requestCode).not.toHaveBeenCalled();
    await click('Send code');
    expect(api.requestCode).toHaveBeenCalledWith('evening', PHONE, 'register');
    await enterCode();
    expect(api.verifyCode).toHaveBeenCalledWith('evening', PHONE, '123456', 'register');
    const body = api.registerStudentApi.mock.calls[0][0];
    expect(body).toMatchObject({ session: 'evening', phone: PHONE, ticket: 'v1.ticket' });
    expect(body.number).toBeUndefined();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('number-popup-number').textContent).toBe('7319');
    expect(dialog.textContent).toContain('for Evening class');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: "I've saved it" })); });
    expect(api.checkinStudent).toHaveBeenLastCalledWith('evening', PHONE, undefined, '7319');
    expect(await screen.findByTestId('pending')).toBeTruthy();
  });

  it('approval off: "I\'ve saved it. Go to class", then in', async () => {
    await renderSessionPage({
      requireApproval: false,
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: approved }),
        registerStudentApi: saved(approved),
      },
    });
    await click('Check in');
    await click('Register');
    await click('Send code');
    await enterCode();
    await click("I've saved it. Go to class");
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('registering with the phone they have: the pop-up first, then the code there, saved under it', async () => {
    const { api } = await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        registerStudentApi: saved(),
      },
    });
    await click('Check in');
    await click('Register');
    await click("That phone isn't near me. Use a different number.");
    await act(async () => {
      fireEvent.change(document.querySelector('[data-testid="different-number-step"] input[type="tel"]'), { target: { value: '722000008' } });
    });
    await click('Send code');
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('From now on, 07•• ••• 008 will be your number for checking in to Evening class, and for messages from your teacher.');
    expect(api.requestCode).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, use this number' })); });
    expect(api.requestCode).toHaveBeenCalledWith('evening', OTHER_PHONE, 'register');
    await enterCode();
    expect(api.verifyCode).toHaveBeenCalledWith('evening', OTHER_PHONE, '123456', 'register');
    expect(api.registerStudentApi.mock.calls[0][0]).toMatchObject({ phone: OTHER_PHONE, ticket: 'v1.ticket' });
    await click("I've saved it");
    expect(api.checkinStudent).toHaveBeenLastCalledWith('evening', OTHER_PHONE, undefined, '7319');
  });

  it('a phone that cannot register (already registered): back to the card with the reason', async () => {
    await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      checkinCard: ({ submit, notice }) => (
        <div data-testid="card">{notice?.text && <p data-testid="notice">{notice.text}</p>}<button type="button" onClick={submit}>Check in</button></div>
      ),
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }),
        requestCode: vi.fn().mockRejectedValue(refusal('already_registered', 'That number is already registered for this class. Check in instead.')),
      },
    });
    await click('Check in');
    await click('Register');
    await click('Send code');
    expect((await screen.findByTestId('notice')).textContent).toBe('That number is already registered for this class. Check in instead.');
  });
});

describe('the form itself', () => {
  it('admission numbers on: no number box; a code comes next', async () => {
    unmockSessionPage();
    vi.doUnmock('@/features/registration/components/RegistrationForm');
    const { default: RegistrationForm } = await import('@/features/registration/components/RegistrationForm');
    render(<MemoryRouter><RegistrationForm numbers phoneNumber={PHONE} onSubmit={vi.fn()} onBack={vi.fn()} loading={false} classes={['Form 3']} /></MemoryRouter>);
    expect(screen.queryByLabelText(/admission number/i)).toBeNull();
    expect(screen.getByText('We will send a code to this number to confirm it.')).toBeTruthy();
  });
});
