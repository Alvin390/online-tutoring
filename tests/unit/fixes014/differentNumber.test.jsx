import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE, OTHER_PHONE } from '../fixes002/sessionPageHarness';

/**
 * 014Fixes / 05 — "That phone isn't near me" (owner ruling 8): only for a
 * phone never confirmed; type the phone you have → a pop-up says it will be
 * your number from now on, BEFORE any code is sent → the code goes to the
 * new phone → the registration moves → the number is given → in, all with
 * the NEW phone. Once per student (the server's words when refused).
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const typeTel = async (value) => {
  await act(async () => { fireEvent.change(document.querySelector('[data-testid="different-number-step"] input[type="tel"]'), { target: { value } }); });
};

// Each test walks the whole page, cold modules included: up to ~8 s on a
// loaded machine, so 20 s rather than the default 5.
// The admission-number steps are a lazy chunk; compile it once up front (the
// compile cache outlives vi.resetModules), so no test pays for it cold.
beforeAll(async () => { await import('@/features/registration/components/numbers'); }, 60_000);
beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

async function toDifferent(api) {
  const page = await renderSessionPage({ flags: { 'checkin.admissionNumbers': true }, api });
  await click('Check in');
  await screen.findByTestId('confirm-step');
  await click("That phone isn't near me. Use a different number.");
  await screen.findByTestId('different-number-step');
  return page;
}

describe('moving to the phone they have', { timeout: 20_000 }, () => {
  it('pop-up before any code → code to the new phone → moved → number given → in with the new phone', async () => {
    const { api } = await toDifferent({
      checkinStudent: vi.fn()
        .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
        .mockResolvedValue({ exists: true, student: approved }),
      fixNumberConfirm: vi.fn().mockResolvedValue({ ok: true, phone: OTHER_PHONE, ticket: 'v1.fix', next: 'assignNumber', numberKind: 'student' }),
    });
    await typeTel('722000008');
    await click('Send code');

    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('This will be your new number')).toBeTruthy();
    expect(dialog.textContent).toContain('From now on, 07•• ••• 008 will be your number for checking in to Evening, and for messages from your teacher. 07•• ••• 009 will stop working.');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.fixNumberRequest).not.toHaveBeenCalled();

    await click('Send code');
    dialog = screen.getByRole('dialog');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, use this number' })); });
    expect(api.fixNumberRequest).toHaveBeenCalledWith('evening', OTHER_PHONE, { oldPhone: PHONE });

    const code = await screen.findByTestId('code-step');
    expect(code.textContent).toContain('We sent a 6-digit code to 07•• ••• 008.');
    await act(async () => { fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } }); });
    await click('Confirm');
    expect(api.fixNumberConfirm).toHaveBeenCalledWith('evening', OTHER_PHONE, { oldPhone: PHONE }, { code: '123456' });
    expect(api.assignNumber).toHaveBeenCalledWith('evening', OTHER_PHONE, 'v1.fix');

    await click("I've saved it. Go to class");
    expect(api.checkinStudent).toHaveBeenLastCalledWith('evening', OTHER_PHONE, undefined, '7319');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('a move that stopped half-way is finished with its ticket; a number already held → type it, with the new phone', async () => {
    await toDifferent({
      checkinStudent: vi.fn()
        .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
        .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.')),
      fixNumberConfirm: vi.fn()
        .mockResolvedValueOnce({ ok: true, partial: true, ticket: 'v1.part' })
        .mockResolvedValueOnce({ ok: true, phone: OTHER_PHONE, ticket: 'v1.fix', next: 'checkin', numberKind: 'student' }),
    });
    await typeTel('722000008');
    await click('Send code');
    await click('Yes, use this number');
    await act(async () => { fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } }); });
    await click('Confirm');
    const step = await screen.findByTestId('number-step');
    expect(step.textContent).toContain('07•• ••• 008');
  });
});

describe('when it is not offered, or refused', { timeout: 20_000 }, () => {
  it('a phone confirmed already (choose_number): no "isn\'t near me"', async () => {
    await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal('choose_number', 'Choose your admission number to continue.')) },
    });
    await click('Check in');
    await screen.findByTestId('confirm-step');
    expect(screen.queryByRole('button', { name: /isn't near me/ })).toBeNull();
  });

  it('changed once already: the server\'s words, on the step', async () => {
    await toDifferent({
      checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.')),
      fixNumberRequest: vi.fn().mockRejectedValue(refusal('already_fixed', 'Your number has already been changed once. To change it again, ask your teacher.')),
    });
    await typeTel('722000008');
    await click('Send code');
    await click('Yes, use this number');
    expect((await screen.findByRole('alert')).textContent).toBe('Your number has already been changed once. To change it again, ask your teacher.');
    expect(screen.getByTestId('different-number-step')).toBeTruthy();
  });

  it('the same phone again: said plainly, nothing sent', async () => {
    const { api } = await toDifferent({
      checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.')),
    });
    await typeTel('711000009');
    await click('Send code');
    expect(screen.getByRole('alert').textContent).toBe('That is the number you started with. Enter the phone you have with you now.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.fixNumberRequest).not.toHaveBeenCalled();
  });
});
