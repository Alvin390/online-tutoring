import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 014Fixes / 07 — the edges: "We couldn't find this number" (N1) before the
 * form; the switch changing while a student is part-way (the page follows
 * the server, or re-reads its settings once); every existing screen still
 * reached with the switch on (blocked, rejected, waiting).
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const pending = { studentName: 'New', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
// The steps are a lazy chunk: a file's first test loads it cold (over 1 s on a loaded machine).
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name }, { timeout: 5000 })); }); };
const ON = { 'checkin.admissionNumbers': true };

// The admission-number steps are a lazy chunk; compile it once up front (the
// compile cache outlives vi.resetModules), so no test pays for it cold.
beforeAll(async () => { await import('@/features/registration/components/numbers'); }, 60_000);
beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

describe('N1: we couldn\'t find this number', { timeout: 20_000 }, () => {
  it('with numbers on: what to do now, then Register → the form; Back → the phone refilled', async () => {
    await renderSessionPage({
      flags: ON,
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }) },
      checkinCard: ({ submit, initialPhone }) => (
        <div data-testid="card"><span data-testid="refill">{initialPhone}</span><button type="button" onClick={submit}>Check in</button></div>
      ),
    });
    await click('Check in');
    const n1 = await screen.findByTestId('not-registered');
    expect(within(n1).getByRole('heading', { name: "We couldn't find this number" })).toBeTruthy();
    expect(n1.textContent).toContain("07•• ••• 009 isn't registered in this class.");
    expect(n1.textContent).toContain('Registered with a different number? Tap Back and enter that number. When we offer to send the code, tap "That phone isn\'t near me" to switch to this number.');
    expect(n1.textContent).toContain("If you don't remember which number you registered with, ask your teacher.");
    await act(async () => { fireEvent.click(within(n1).getByRole('button', { name: 'Back' })); });
    expect(screen.getByTestId('refill').textContent).toBe(PHONE);
    await click('Check in');
    await act(async () => { fireEvent.click(within(await screen.findByTestId('not-registered')).getByRole('button', { name: 'Register' })); });
    expect(await screen.findByTestId('register')).toBeTruthy();
  });

  it('with numbers off: straight to the form, as before', async () => {
    await renderSessionPage({ api: { checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }) } });
    await click('Check in');
    expect(await screen.findByTestId('register')).toBeTruthy();
    expect(screen.queryByTestId('not-registered')).toBeNull();
  });
});

describe('the switch changing part-way', { timeout: 20_000 }, () => {
  it('switched off after the code (no ticket comes back): checked in again by phone, straight to class', async () => {
    const { api } = await renderSessionPage({
      flags: ON,
      api: {
        checkinStudent: vi.fn()
          .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
          .mockResolvedValue({ exists: true, student: approved }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, customToken: 'x', uid: 'u' }), // the switch-off answer
      },
    });
    await click('Check in');
    await click('Send code');
    await act(async () => { fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } }); });
    await click('Confirm');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
    const last = api.checkinStudent.mock.calls.at(-1);
    expect(last.slice(0, 2)).toEqual(['evening', PHONE]);
    expect(last[3] ?? null).toBeNull(); // the phone alone
    expect(api.assignNumber).not.toHaveBeenCalled();
  });

  it('switched off before the number was given: checked in again by phone, no dead end', async () => {
    await renderSessionPage({
      flags: ON,
      api: {
        checkinStudent: vi.fn()
          .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
          .mockResolvedValue({ exists: true, student: approved }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.t', next: 'assignNumber', numberKind: 'student' }),
        assignNumber: vi.fn().mockRejectedValue(refusal('refresh_needed', 'This page is out of date. Close it, then open the class link again and check in.')),
      },
    });
    await click('Check in');
    await click('Send code');
    await act(async () => { fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } }); });
    await click('Confirm');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('switched off while registering: the code request "not found" → settings re-read once → saved without a code, nothing retyped', async () => {
    const { api } = await renderSessionPage({
      flags: ON,
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        requestCode: vi.fn().mockRejectedValue(refusal('not_found', 'No registration found for that number.', 404)),
        getPublicBootstrap: vi.fn().mockResolvedValue({ flags: { 'checkin.admissionNumbers': false }, sessions: [] }),
        registerStudentApi: vi.fn().mockResolvedValue({ ok: true, student: pending }),
      },
    });
    await click('Check in');
    await click('Register'); // N1
    await click('Register'); // the form
    await click('Send code');
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(api.getPublicBootstrap).toHaveBeenCalledTimes(1);
    expect(api.getPublicBootstrap).toHaveBeenCalledWith({ force: true, fresh: true });
    const body = api.registerStudentApi.mock.calls[0][0];
    expect(body).toMatchObject({ studentName: 'New', class: 'Form 3' });
    expect(body.ticket).toBeUndefined();
  });

  it('still on: a wrong registration code re-reads the settings once, then says so as usual', async () => {
    const { api } = await renderSessionPage({
      flags: ON,
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }),
        verifyCode: vi.fn().mockRejectedValue(refusal('invalid_code', 'That code is not valid or has expired.', 400)),
        getPublicBootstrap: vi.fn().mockResolvedValue({ flags: { 'checkin.admissionNumbers': true }, sessions: [] }),
      },
    });
    await click('Check in');
    await click('Register');
    await click('Register');
    await click('Send code');
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } }); }); // eslint-disable-line no-await-in-loop
      await click('Confirm'); // eslint-disable-line no-await-in-loop
      expect((await screen.findByRole('alert')).textContent).toBe('That code is not valid or has expired.'); // eslint-disable-line no-await-in-loop
    }
    expect(api.getPublicBootstrap).toHaveBeenCalledTimes(1);
    expect(api.registerStudentApi).not.toHaveBeenCalled();
  });
});

describe('the existing screens, with the switch on', { timeout: 20_000 }, () => {
  for (const [name, student, testId] of [
    ['blocked', { ...approved, blocked: true, blockReason: 'Fees' }, 'blocked'],
    ['waiting for approval', pending, 'pending'],
  ]) {
    it(`a number checks in to the ${name} screen`, async () => {
      await renderSessionPage({
        flags: ON,
        api: {
          checkinStudent: vi.fn()
            .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.'))
            .mockResolvedValue({ exists: true, student }),
        },
      });
      await click('Check in');
      await act(async () => { fireEvent.change(await screen.findByLabelText('Admission number'), { target: { value: '4071' } }); });
      await act(async () => { fireEvent.click(within(screen.getByTestId('number-step')).getByRole('button', { name: 'Check in' })); });
      expect(await screen.findByTestId(testId)).toBeTruthy();
    });
  }
});
