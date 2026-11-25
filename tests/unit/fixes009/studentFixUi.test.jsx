import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 009Fixes / 03 — the student pages:
 *   code-first registration (form → code → saved → check in), the typing
 *   kept when a save fails after the code;
 *   "Use my real number" on the code step (010Fixes / 04; by the number they
 *   registered with) and "Registered before with a different phone number?"
 *   (by name and class) → code to the real number → choose a number → back to
 *   check in with the real number filled in.
 */

const REAL = '+254733000007';
const ON = { 'checkin.admissionNumbers': true, 'student.fixNumber': true };
const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
// The steps are a lazy chunk: a file's first test loads it cold (over 1 s on a loaded machine).
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name }, { timeout: 5000 })); }); };
const type = async (label, value) => { await act(async () => { fireEvent.change(await screen.findByLabelText(label), { target: { value } }); }); };
const probeCard = ({ submit, notice, initialPhone }) => (
  <div data-testid="card">
    {notice?.text && <p data-testid="notice" data-tone={notice.tone}>{notice.text}</p>}
    <span data-testid="refill">{initialPhone}</span>
    <button type="button" onClick={submit}>Check in</button>
  </div>
);

// The admission-number steps are a lazy chunk; compile it once up front (the
// compile cache outlives vi.resetModules), so no test pays for it cold.
beforeAll(async () => { await import('@/features/registration/components/numbers'); }, 60_000);
beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

// 014Fixes / 06: registering is form → code → saved with a GIVEN number →
// the pop-up (tests/unit/fixes014/registerSteps.test.jsx walks it, with the
// "nothing saved before the code" and "cannot register" cases).
describe('code-first registration', { timeout: 20_000 }, () => {
  it('a save refused after the code: back to the form (still there), and a retry needs no new code', async () => {
    const register = vi.fn()
      .mockRejectedValueOnce(refusal('invalid_class', 'Please choose a class from the list.', 400))
      .mockResolvedValue({ ok: true, next: 'checkin', student: pending, number: { kind: 'student', digits: '7319', display: '7319' } });
    const { api } = await renderSessionPage({
      checkinCard: probeCard, flags: ON,
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.reg', next: 'register' }),
        registerStudentApi: register,
      },
    });
    await click('Check in');
    await click('Register'); // 014Fixes / 07: N1 first
    await click('Register');
    // The code step is a lazy chunk; this test is the first to load it.
    await screen.findByTestId('confirm-step', {}, { timeout: 5000 });
    await click('Send code');
    await type('Code', '123456');
    await click('Confirm');
    await waitFor(() => expect(screen.getByTestId('register').closest('[hidden]')).toBeNull());
    await click('Register');
    await waitFor(() => expect(register).toHaveBeenCalledTimes(2));
    expect(register.mock.calls[1][0]).toMatchObject({ ticket: 'v1.reg' });
    expect(register.mock.calls[1][0].number).toBeUndefined();
    expect(api.requestCode).toHaveBeenCalledTimes(1);
  });
});

describe('fix my number', { timeout: 20_000 }, () => {
  // 014Fixes / 04: "Use my real number" left the code step; phase 05 brings
  // it back as "That phone isn't near me" (tests/unit/fixes014/differentNumber.test.jsx).
  it('registered before with another number: by name and class, moved to the number typed', async () => {
    const { api } = await renderSessionPage({
      checkinCard: probeCard, flags: ON, classes: ['Form 3', 'Grade 8'],
      api: {
        checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
        fixNumberConfirm: vi.fn().mockResolvedValue({ ok: true, phone: PHONE, ticket: 'v1.fix', next: 'checkin', numberKind: 'student' }),
      },
    });
    await click('Check in');
    await click('Register'); // 014Fixes / 07: N1 first (this link goes in phase 08)
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
    await click('Register'); // 014Fixes / 07: N1 first (this link goes in phase 08)
    await click('Registered before with a different phone number? Find your registration');
    await type('Your full name (as you registered)', 'Wanjiru Akinyi');
    await act(async () => { fireEvent.change(screen.getByLabelText('Your class'), { target: { value: 'Form 3' } }); });
    await click('Send me a code');
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't find you. Check the details, or ask your teacher.");
  });

});

// 014Fixes: one switch (checkin.admissionNumbers), and registration is
// always code first with it on — the old "flag off" path is gone.
