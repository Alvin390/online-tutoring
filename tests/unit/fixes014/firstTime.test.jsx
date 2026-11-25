import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, render, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 014Fixes / 04 — no number yet (owner, 2026-11-24): "Confirm your phone"
 * says where the code goes and to keep that phone near, and sends only on
 * Send code; "Enter the code"; then the school GIVES the number in a pop-up
 * (for {Session} class, Copy, don't forget, sent by SMS) that only its own
 * button closes; then the student is checked in with it.
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };

// The admission-number steps are a lazy chunk; compile it once up front (the
// compile cache outlives vi.resetModules), so no test pays for it cold.
beforeAll(async () => { await import('@/features/registration/components/numbers'); }, 60_000);
beforeEach(() => vi.resetModules());
afterEach(() => {
  cleanup();
  unmockSessionPage();
  vi.doUnmock('@services/api/studentAdmission');
  vi.useRealTimers();
});

async function renderConfirm(api = {}, props = {}) {
  const calls = {
    requestCode: vi.fn().mockResolvedValue({ ok: true, deliveryChannel: 'sms', retryAfterSeconds: 60 }),
    verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' }),
    ...api,
  };
  vi.doMock('@services/api/studentAdmission', () => ({ requestCode: calls.requestCode, verifyCode: calls.verifyCode, assignNumber: vi.fn() }));
  const { default: ConfirmPhoneStep } = await import('@/features/registration/components/numbers/ConfirmPhoneStep');
  const handlers = { onVerified: vi.fn(), onBack: vi.fn() };
  render(<ConfirmPhoneStep session="evening" phone={PHONE} {...handlers} {...props} />);
  return { calls, ...handlers };
}

async function renderPopup(props = {}) {
  const { default: NumberPopup } = await import('@/features/registration/components/numbers/NumberPopup');
  const onDone = vi.fn();
  render(<NumberPopup kind="student" display="7319" session="Evening" onDone={onDone} {...props} />);
  return { onDone };
}

describe('"Confirm your phone"', () => {
  it('says where the code goes and to keep it near; sends only on Send code', async () => {
    const { calls } = await renderConfirm();
    const step = screen.getByTestId('confirm-step');
    expect(within(step).getByRole('heading', { name: 'Confirm your phone' })).toBeTruthy();
    expect(step.textContent).toContain("We'll send a 6-digit code by SMS to 07•• ••• 009. Make sure that phone is near you so you can see the code.");
    expect(calls.requestCode).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })); });
    expect(calls.requestCode).toHaveBeenCalledWith('evening', PHONE);
    const code = screen.getByTestId('code-step');
    expect(within(code).getByRole('heading', { name: 'Enter the code' })).toBeTruthy();
    expect(code.textContent).toContain('We sent a 6-digit code to 07•• ••• 009.');
    expect(screen.getByRole('button', { name: /Send again in (59|60) s/ })).toBeTruthy();
    expect(screen.getByTestId('code-help').textContent).toBe("Didn't get it? Tap Send again when the countdown ends. Still nothing? Your teacher can see your code. Ask your teacher.");
  });

  it('a wrong code in plain words; a right one goes on with the ticket', async () => {
    const { calls, onVerified } = await renderConfirm({
      verifyCode: vi.fn()
        .mockRejectedValueOnce(refusal('invalid_code', 'That code is not valid or has expired.', 400))
        .mockResolvedValueOnce({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' }),
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })); });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    expect(screen.getByRole('alert').textContent).toBe('That code is not valid or has expired.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    expect(calls.verifyCode).toHaveBeenLastCalledWith('evening', PHONE, '123456');
    expect(onVerified).toHaveBeenCalledWith({ ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' });
  });

  it('no SMS could be sent: ask your teacher for the code', async () => {
    await renderConfirm({ requestCode: vi.fn().mockResolvedValue({ ok: true, deliveryChannel: 'teacher', retryAfterSeconds: 60 }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })); });
    expect(screen.getByTestId('code-step').textContent).toContain("We couldn't send an SMS right now. Ask your teacher for your code.");
  });

  it('"That phone isn\'t near me" only when the page offers it', async () => {
    await renderConfirm();
    expect(screen.queryByRole('button', { name: /isn't near me/ })).toBeNull();
    cleanup();
    vi.resetModules();
    const onDifferentNumber = vi.fn();
    await renderConfirm({}, { onDifferentNumber });
    fireEvent.click(screen.getByRole('button', { name: "That phone isn't near me. Use a different number." }));
    expect(onDifferentNumber).toHaveBeenCalled();
  });
});

describe('the number pop-up', () => {
  it('the number, for which session, Copy, and "don\'t forget"', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { onDone } = await renderPopup();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Your admission number')).toBeTruthy();
    expect(screen.getByTestId('number-popup-number').textContent).toBe('7319');
    expect(dialog.textContent).toContain('This is your admission number for Evening.');
    expect(dialog.textContent).toContain("Don't forget it. Every time you check in, you'll enter your phone number, then this number. We've also sent it to you by SMS.");
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Copy number/ })); });
    expect(writeText).toHaveBeenCalledWith('7319');
    expect(within(dialog).getByRole('button', { name: /Copied/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: "I've saved it. Go to class" }));
    expect(onDone).toHaveBeenCalled();
  });

  it('closed only by its own button: no ×, Escape and a tap outside do nothing', async () => {
    const { onDone } = await renderPopup();
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('no clipboard: says to select it or write it down', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    await renderPopup();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy number/ })); });
    expect(screen.getByRole('status').textContent).toBe('Select the number above and copy it, or write it down.');
  });

  it('staff: the staff number; after approval: "I\'ve saved it"', async () => {
    await renderPopup({ kind: 'staff', display: 'S-7319', afterApproval: true });
    expect(screen.getByText('Your staff number')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('This is your staff number for Evening.');
    expect(screen.getByRole('button', { name: "I've saved it" })).toBeTruthy();
  });
});

describe('the page: phone → confirm → number given → in', { timeout: 20_000 }, () => {
  const flow = async (overrides) => {
    const page = await renderSessionPage({ flags: { 'checkin.admissionNumbers': true }, api: overrides });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    await screen.findByTestId('confirm-step');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send code' })); });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    return page;
  };

  it('no number: the number is given, shown, then the student is checked in with it', async () => {
    const { api } = await flow({
      checkinStudent: vi.fn()
        .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
        .mockResolvedValue({ exists: true, student: approved }),
      verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' }),
    });
    expect(api.assignNumber).toHaveBeenCalledWith('evening', PHONE, 'v1.t');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('number-popup-number').textContent).toBe('7319');
    expect(dialog.textContent).toContain('for Evening');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: "I've saved it. Go to class" })); });
    expect(api.checkinStudent).toHaveBeenLastCalledWith('evening', PHONE, undefined, '7319');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('a number already, phone unconfirmed: after the code, type the number', async () => {
    const { api } = await flow({
      // 014Fixes / 07: after the code the page checks in again by phone; the server leads on.
      checkinStudent: vi.fn()
        .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
        .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.')),
      verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'checkin', numberKind: 'student' }),
    });
    expect(await screen.findByTestId('number-step')).toBeTruthy();
    expect(api.assignNumber).not.toHaveBeenCalled();
  });

  it('confirmed without a number (choose_number): the same short code step, then given', async () => {
    const { api } = await flow({
      checkinStudent: vi.fn().mockRejectedValueOnce(refusal('choose_number', 'Choose your admission number to continue.')),
      verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'staff' }),
      assignNumber: vi.fn().mockResolvedValue({ ok: true, kind: 'staff', number: '7319', display: 'S-7319' }),
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Your staff number')).toBeTruthy();
    expect(api.assignNumber).toHaveBeenCalled();
  });

  it('the school says a number exists already: the number step (ask your teacher)', async () => {
    await flow({
      checkinStudent: vi.fn()
        .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
        .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.')),
      verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' }),
      assignNumber: vi.fn().mockRejectedValue(refusal('already_has_number', 'You already have an admission number for this class. Ask your teacher for it.')),
    });
    expect(await screen.findByTestId('number-step')).toBeTruthy();
  });
});
