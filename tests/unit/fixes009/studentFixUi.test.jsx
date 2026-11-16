import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 009Fixes / 03 — the student pages:
 *   code-first registration (form → code → saved → check in), the typing
 *   kept when a save fails after the code;
 *   "Didn't get the code? Your number may be wrong" (by the number they
 *   registered with) and "Registered before with a different phone number?"
 *   (by name and class) → code to the real number → choose a number → back to
 *   check in with the real number filled in.
 */

const REAL = '+254733000007';
const ON = { 'checkin.admissionNumbers': true, 'student.fixNumber': true };
const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const type = async (label, value) => { await act(async () => { fireEvent.change(await screen.findByLabelText(label), { target: { value } }); }); };
const probeCard = ({ submit, notice, initialPhone }) => (
  <div data-testid="card">
    {notice?.text && <p data-testid="notice" data-tone={notice.tone}>{notice.text}</p>}
    <span data-testid="refill">{initialPhone}</span>
    <button type="button" onClick={submit}>Check in</button>
  </div>
);

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

describe('code-first registration', () => {
  it('form → code to that number → saved with the ticket → checked in with the chosen number', async () => {
    const checkin = vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending });
    const { api, typed } = await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: checkin,
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.reg', next: 'register' }),
        registerStudentApi: vi.fn().mockResolvedValue({ ok: true, next: 'checkin', student: pending }),
      },
    });
    await click('Check in');
    typed.regNumber = '5820';
    await click('Register');
    expect(api.registerStudentApi).not.toHaveBeenCalled(); // nothing saved before the code
    expect(await screen.findByTestId('code-step')).toBeTruthy();
    expect(api.requestCode).toHaveBeenCalledWith('evening', PHONE, 'register');
    await type('Code', '123456');
    await click('Confirm');
    expect(api.verifyCode).toHaveBeenCalledWith('evening', PHONE, '123456', 'register');
    await waitFor(() => expect(api.registerStudentApi).toHaveBeenCalledTimes(1));
    expect(api.registerStudentApi.mock.calls[0][0]).toMatchObject({ number: '5820', ticket: 'v1.reg' });
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(checkin.mock.calls.at(-1)[3]).toBe('5820');
  });

  it('a save refused after the code: back to the form (still there), and a retry needs no new code', async () => {
    const register = vi.fn()
      .mockRejectedValueOnce(refusal('number_taken', 'That admission number is taken. Choose another.'))
      .mockResolvedValue({ ok: true, next: 'checkin', student: pending });
    const { api, typed } = await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.reg', next: 'register' }),
        registerStudentApi: register,
      },
    });
    await click('Check in');
    typed.regNumber = '5820';
    await click('Register');
    await type('Code', '123456');
    await click('Confirm');
    await waitFor(() => expect(screen.getByTestId('register').closest('[hidden]')).toBeNull());
    typed.regNumber = '7419';
    await click('Register');
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls[1][0]).toMatchObject({ number: '7419', ticket: 'v1.reg' });
    expect(api.requestCode).toHaveBeenCalledTimes(1);
  });

  it('a number that cannot register (already registered): back to the card with the reason', async () => {
    await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
        requestCode: vi.fn().mockRejectedValue(refusal('already_registered', 'That number is already registered for this class. Check in instead.')),
      },
    });
    await click('Check in');
    await click('Register');
    expect((await screen.findByTestId('notice')).textContent).toBe('That number is already registered for this class. Check in instead.');
  });
});

describe('fix my number', () => {
  it('from the code step: real number → code → choose a number → check in with the real number', async () => {
    const { api } = await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.')) },
    });
    await click('Check in');
    await click("Didn't get the code? Your number may be wrong.");
    const fix = await screen.findByTestId('fix-number');
    expect(fix.textContent).toMatch(/uses the number ending in 009/);
    await waitFor(() => expect(fix.querySelector('input[type="tel"]').disabled).toBe(false));
    await act(async () => { fireEvent.change(fix.querySelector('input[type="tel"]'), { target: { value: '733000007' } }); });
    await click('Send me a code');
    expect(api.fixNumberRequest).toHaveBeenCalledWith('evening', REAL, { oldPhone: PHONE });
    expect((await screen.findByTestId('fix-number')).textContent).toMatch(/ending in 007/);
    await type('Code', '654321');
    await click('Confirm');
    expect(api.fixNumberConfirm).toHaveBeenCalledWith('evening', REAL, { oldPhone: PHONE }, { code: '654321' });
    expect(await screen.findByTestId('choose-step')).toBeTruthy();
    await type(/Choose your 4-digit admission number/, '4071');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use 4071' }).disabled).toBe(false));
    await click('Use 4071');
    expect(api.chooseNumber).toHaveBeenCalledWith('evening', REAL, '4071', 'v1.fix');
    expect((await screen.findByTestId('notice')).textContent).toMatch(/now the one ending in 007, and your admission number is 4071/);
    expect(screen.getByTestId('refill').textContent).toBe(REAL);
  });

  it('registered before with another number: by name and class, moved to the number typed', async () => {
    const { api } = await renderSessionPage({
      checkinCard: probeCard, flags: ON, classes: ['Form 3', 'Grade 8'],
      api: {
        checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
        fixNumberConfirm: vi.fn().mockResolvedValue({ ok: true, phone: PHONE, ticket: 'v1.fix', next: 'checkin', numberKind: 'student' }),
      },
    });
    await click('Check in');
    await click('Registered before with a different phone number? Find your registration');
    const fix = await screen.findByTestId('fix-number');
    expect(fix.textContent).toMatch(/move your registration to the number ending in 009/);
    await type('Your full name (as you registered)', 'Wanjiru');
    await click('Send me a code');
    expect((await within(fix).findByRole('alert')).textContent).toBe('Enter your full name, as you registered.');
    await type('Your full name (as you registered)', 'Wanjiru Akinyi');
    await act(async () => { fireEvent.change(screen.getByLabelText('Your class'), { target: { value: 'Form 3' } }); });
    await click('Send me a code');
    expect(api.fixNumberRequest).toHaveBeenCalledWith('evening', PHONE, { studentName: 'Wanjiru Akinyi', class: 'Form 3' });
    await type('Code', '654321');
    await click('Confirm');
    expect((await screen.findByTestId('notice')).textContent).toMatch(/now the one ending in 009\. Check in with your admission number and this phone/);
    expect(screen.getByTestId('refill').textContent).toBe(PHONE);
  });

  it('the server\'s refusal shows in the step (e.g. not found)', async () => {
    await renderSessionPage({
      checkinCard: probeCard, flags: ON, classes: ['Form 3'],
      api: {
        checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
        fixNumberRequest: vi.fn().mockRejectedValue(refusal('not_found', "We couldn't find you. Check the details, or ask your teacher.", 404)),
      },
    });
    await click('Check in');
    await click('Registered before with a different phone number? Find your registration');
    await type('Your full name (as you registered)', 'Wanjiru Akinyi');
    await act(async () => { fireEvent.change(screen.getByLabelText('Your class'), { target: { value: 'Form 3' } }); });
    await click('Send me a code');
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't find you. Check the details, or ask your teacher.");
  });

  it('a move that stopped half-way finishes with its ticket', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce({ ok: true, partial: true, ticket: 'v1.half' })
      .mockResolvedValueOnce({ ok: true, phone: REAL, ticket: 'v1.fix', next: 'checkin' });
    await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm.')), fixNumberConfirm: confirm },
    });
    await click('Check in');
    await click("Didn't get the code? Your number may be wrong.");
    const fix = await screen.findByTestId('fix-number');
    await waitFor(() => expect(fix.querySelector('input[type="tel"]').disabled).toBe(false));
    await act(async () => { fireEvent.change(fix.querySelector('input[type="tel"]'), { target: { value: '733000007' } }); });
    await click('Send me a code');
    await type('Code', '654321');
    await click('Confirm');
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[1][3]).toEqual({ ticket: 'v1.half' });
    expect(await screen.findByTestId('notice')).toBeTruthy();
  });
});

describe('flag off', () => {
  it('no links, and registration saves first as before', async () => {
    const { api } = await renderSessionPage({
      checkinCard: probeCard, flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockRejectedValueOnce(refusal('verify_required', 'Confirm.')),
        registerStudentApi: vi.fn().mockResolvedValue({ ok: true, next: 'verify', student: pending }),
      },
    });
    await click('Check in');
    expect(screen.queryByRole('button', { name: /Registered before with a different phone number/ })).toBeNull();
    await click('Register');
    expect(api.registerStudentApi).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('code-step')).toBeTruthy();
    expect(api.requestCode).toHaveBeenCalledWith('evening', PHONE);
    expect(screen.queryByRole('button', { name: /Your number may be wrong/ })).toBeNull();
  });
});
