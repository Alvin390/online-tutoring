import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, render, within } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 014Fixes / 03 — phone first, then "Type your admission number" (owner,
 * 2026-11-24): the first screen is the phone only, on or off; with numbers
 * on, a one-device note under Continue. A phone that has a number goes to
 * the number step (for {Session} class, the phone masked, Change, "Forgot?"
 * → ask your teacher); a wrong number or another device is said there.
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const NOTE = 'Once you check in on a device, no other device can check in with your number until this class ends. You can use a different device next class. If your phone stops working, ask your teacher.';

// The admission-number steps are a lazy chunk; compile it once up front (the
// compile cache outlives vi.resetModules), so no test pays for it cold.
beforeAll(async () => { await import('@/features/registration/components/numbers'); }, 60_000);
beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

async function renderCard(props = {}) {
  vi.doUnmock('@/features/registration/components/CheckinCard');
  const { default: CheckinCard } = await import('@/features/registration/components/CheckinCard');
  const onSubmit = vi.fn();
  render(<CheckinCard onSubmit={onSubmit} loading={false} {...props} />);
  return { onSubmit };
}

async function renderStep(props = {}) {
  const { default: NumberStep } = await import('@/features/registration/components/numbers/NumberStep');
  const handlers = { onSubmit: vi.fn(), onChangePhone: vi.fn() };
  const utils = render(<NumberStep phone={PHONE} session="Evening" {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

describe('the first screen: the phone only', () => {
  for (const numbers of [false, true]) {
    it(`numbers ${numbers ? 'on' : 'off'}: no admission-number box; submits the phone alone`, async () => {
      const { onSubmit } = await renderCard({ numbers });
      expect(screen.queryByLabelText(/admission number/i)).toBeNull();
      expect(screen.queryByText(/First time with admission numbers/)).toBeNull();
      expect(screen.getByText("Enter your parent's phone number to continue")).toBeTruthy();
      await act(async () => { fireEvent.change(document.querySelector('input[type="tel"]'), { target: { value: '711000009' } }); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continue/ })); });
      expect(onSubmit).toHaveBeenCalledWith(PHONE);
      expect(onSubmit.mock.calls[0]).toHaveLength(1);
    });
  }

  it('the one-device note: only with numbers on, in the approved words', async () => {
    await renderCard({ numbers: true });
    expect(screen.getByTestId('one-device-note').textContent.trim()).toBe(NOTE);
    cleanup();
    await renderCard({ numbers: false });
    expect(screen.queryByTestId('one-device-note')).toBeNull();
  });
});

describe('"Type your admission number"', () => {
  it('names the session, shows the phone masked, and Change goes back', async () => {
    const { onChangePhone } = await renderStep();
    expect(screen.getByRole('heading', { name: 'Type your admission number' })).toBeTruthy();
    const line = screen.getByTestId('number-step-phone');
    expect(line.textContent).toContain('for Evening');
    expect(line.textContent).toContain('07•• ••• 009');
    expect(line.textContent).not.toContain('711000009');
    fireEvent.click(within(line).getByRole('button', { name: 'Change' }));
    expect(onChangePhone).toHaveBeenCalled();
  });

  it('a malformed number is refused on the phone; students and staff numbers go through', async () => {
    const { onSubmit } = await renderStep();
    const box = screen.getByLabelText('Admission number');
    fireEvent.change(box, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter your 4-digit admission number (staff: S- and 4 digits).');
    expect(onSubmit).not.toHaveBeenCalled();
    for (const ok of ['4071', 'S-4071', 's4071', 'S 4071']) {
      fireEvent.change(box, { target: { value: ok } });
      fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
      expect(onSubmit).toHaveBeenLastCalledWith(ok);
    }
  });

  it('a wrong number in the approved words; another device in the server\'s', async () => {
    const { rerender, onSubmit, onChangePhone } = await renderStep({ refusal: { code: 'number_mismatch', message: 'x' } });
    expect(screen.getByRole('alert').textContent).toBe("That admission number and phone don't match. Check both, or ask your teacher.");
    const { default: NumberStep } = await import('@/features/registration/components/numbers/NumberStep');
    const other = { code: 'other_device', message: 'Your number is already checked in on another device for this class. You can use this device next class, or ask your teacher to allow this one now.' };
    rerender(<NumberStep phone={PHONE} session="Evening" onSubmit={onSubmit} onChangePhone={onChangePhone} refusal={other} />);
    expect(screen.getByRole('alert').textContent).toBe(other.message);
  });

  it('"Forgot your admission number?": you have one, ask your teacher', async () => {
    await renderStep();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your admission number?' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('You already have an admission number')).toBeTruthy();
    expect(within(dialog).getByText('You have an admission number for Evening. Ask your teacher for it, then come back and check in.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the page: phone → number → in', () => {
  it('a phone with a number goes to the number step; the right number checks in', async () => {
    const { api } = await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn()
          .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.'))
          .mockResolvedValue({ exists: true, student: approved }),
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    const step = await screen.findByTestId('number-step');
    expect(step.textContent).toContain('for Evening');
    fireEvent.change(screen.getByLabelText('Admission number'), { target: { value: '4071' } });
    await act(async () => { fireEvent.click(within(step).getByRole('button', { name: 'Check in' })); });
    expect(api.checkinStudent).toHaveBeenLastCalledWith('evening', PHONE, undefined, '4071');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
  });

  it('a wrong number stays on the step, said plainly; Change goes back to the phone', async () => {
    await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn()
          .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.'))
          .mockRejectedValueOnce(refusal('number_mismatch', "That admission number and phone don't match. Check both, or ask your teacher.", 403)),
      },
      checkinCard: ({ submit, initialPhone }) => (
        <div data-testid="card"><span data-testid="refill">{initialPhone}</span><button type="button" onClick={submit}>Check in</button></div>
      ),
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    const step = await screen.findByTestId('number-step');
    fireEvent.change(screen.getByLabelText('Admission number'), { target: { value: '5820' } });
    await act(async () => { fireEvent.click(within(step).getByRole('button', { name: 'Check in' })); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/don't match/);
    expect(screen.getByTestId('number-step')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change' })); });
    expect(screen.getByTestId('refill').textContent).toBe(PHONE);
  });

  it('another device: said on the number step', async () => {
    await renderSessionPage({
      flags: { 'checkin.admissionNumbers': true },
      api: {
        checkinStudent: vi.fn()
          .mockRejectedValueOnce(refusal('number_required', 'Enter your admission number too.'))
          .mockRejectedValueOnce(refusal('other_device', 'Your number is already checked in on another device for this class. You can use this device next class, or ask your teacher to allow this one now.', 403)),
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    const step = await screen.findByTestId('number-step');
    fireEvent.change(screen.getByLabelText('Admission number'), { target: { value: '4071' } });
    await act(async () => { fireEvent.click(within(step).getByRole('button', { name: 'Check in' })); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/You can use this device next class/);
  });
});
