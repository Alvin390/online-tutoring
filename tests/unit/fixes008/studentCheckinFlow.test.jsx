import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, render, waitFor } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from '../fixes002/sessionPageHarness';

/**
 * 008Fixes / 04 — the student pages: the one-form check-in (admission number
 * + phone), the first time (code → choose a number → check in afresh), the
 * refusals in plain words, registration with a number, and every repeat
 * check carrying the number.
 */

const refusal = (code, message, status = 409) => Object.assign(new Error(message), { name: 'ApiError', code, status });
const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false, receiptStatus: 'pending' };
const click = async (name) => {
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); });
};
const type = async (label, value) => {
  await act(async () => { fireEvent.change(await screen.findByLabelText(label), { target: { value } }); });
};

const typeTel = async (value) => {
  await act(async () => { fireEvent.change(document.querySelector('input[type="tel"]'), { target: { value } }); });
};

/** A check-in card that shows what the page tells it (notice, refilled phone). */
const probeCard = ({ submit, notice, initialPhone, numbers }) => (
  <div data-testid="card">
    {notice?.text && <p data-testid="notice" data-tone={notice.tone}>{notice.text}</p>}
    <span data-testid="refill">{initialPhone}</span>
    <span data-testid="numbers">{String(numbers)}</span>
    <button type="button" onClick={submit}>Check in</button>
  </div>
);

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); vi.useRealTimers(); vi.doUnmock('@services/api/client'); vi.doUnmock('@services/api/student'); });

describe('the requests', () => {
  it('check-in sends the device id always, the number when there is one; the class link sends the device id', async () => {
    const apiPost = vi.fn().mockResolvedValue({});
    vi.doMock('@services/api/client', () => ({ apiPost, apiGet: vi.fn() }));
    const student = await import('@services/api/student');
    await student.checkinStudent('evening', PHONE);
    await student.checkinStudent('evening', PHONE, undefined, 'S-4071');
    await student.getClassLink('evening', PHONE);
    const [first, second, link] = apiPost.mock.calls.map(([, body]) => body);
    expect(first.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.number).toBeUndefined();
    expect(second).toMatchObject({ number: 'S-4071', deviceId: first.deviceId });
    expect(link.deviceId).toBe(first.deviceId);
  });

  it('the first-time calls wait as long as check-in does (a copied constant)', async () => {
    const a = await import('@services/api/student');
    const b = await import('@services/api/studentAdmission');
    expect(b.CLASS_TIME_TIMEOUT_MS).toBe(a.CLASS_TIME_TIMEOUT_MS);
  });

  it('registration sends the chosen number (and none when there is none)', async () => {
    const apiPost = vi.fn().mockResolvedValue({});
    vi.doMock('@services/api/client', () => ({ apiPost, apiGet: vi.fn() }));
    const { registerStudentApi } = await import('@services/api/public');
    const form = { session: 'evening', phone: PHONE, studentName: 'Amina', class: 'Form 3', subjects: ['English'], receiptMessage: 'QAB123XYZ9 Confirmed' };
    await registerStudentApi({ ...form, number: '5820' });
    await registerStudentApi(form);
    expect(apiPost.mock.calls[0][1]).toMatchObject({ number: '5820' });
    expect('number' in apiPost.mock.calls[1][1]).toBe(false);
  });

  it('the device id survives a reload (kept in localStorage) and works without storage', async () => {
    localStorage.removeItem('ot.device.v1');
    const a = await import('@utils/deviceId');
    const id = a.getDeviceId();
    a.__resetDeviceId();
    expect(a.getDeviceId()).toBe(id);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    a.__resetDeviceId();
    expect(a.getDeviceId()).toMatch(/^[0-9a-f]{32}$/);
    spy.mockRestore();
  });
});

describe('the first time: phone → code → choose → check in afresh', () => {
  it('walks the whole way, and the repeat checks carry the number', async () => {
    const checkin = vi.fn()
      .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
      .mockResolvedValue({ exists: true, student: pending, pass: 'p1' });
    const { api, typed } = await renderSessionPage({ checkinCard: probeCard, api: { checkinStudent: checkin } });

    await click('Check in');
    expect(await screen.findByTestId('code-step')).toBeTruthy();
    expect(api.requestCode).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ending in/).textContent).toContain(PHONE.slice(-3));

    await type('Code', '123456');
    await click('Confirm');
    expect(api.verifyCode).toHaveBeenCalledWith('evening', PHONE, '123456');
    expect(await screen.findByTestId('choose-step')).toBeTruthy();

    await type(/Choose your 4-digit admission number/, '4071');
    await waitFor(() => expect(api.checkNumber).toHaveBeenCalledWith('evening', '4071', 'student', expect.anything()));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use 4071' }).disabled).toBe(false));
    await click('Use 4071');
    expect(api.chooseNumber).toHaveBeenCalledWith('evening', PHONE, '4071', 'v1.ticket');

    // Back on the card: the number named, the phone refilled, numbers on.
    expect((await screen.findByTestId('notice')).textContent).toMatch(/Your number is 4071\. Don't forget it!/);
    expect(screen.getByTestId('refill').textContent).toBe(PHONE);
    expect(screen.getByTestId('numbers').textContent).toBe('true');

    typed.number = '4071';
    await click('Check in');
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(checkin.mock.calls.at(-1).slice(0, 4)).toEqual(['evening', PHONE, undefined, '4071']);

    // "Check again" sends the number too.
    await click('Check again');
    expect(checkin.mock.calls.at(-1)[3]).toBe('4071');
  });

  it('confirmed earlier but no number and no ticket in this visit: a code first', async () => {
    const checkin = vi.fn().mockRejectedValueOnce(refusal('choose_number', 'Choose your admission number to continue.'));
    await renderSessionPage({ checkinCard: probeCard, api: { checkinStudent: checkin } });
    await click('Check in');
    expect(await screen.findByTestId('code-step')).toBeTruthy();
  });
});

describe('refusals, in plain words on the card (no toast)', () => {
  for (const [code, message] of [
    ['number_mismatch', "That admission number and phone don't match. Check both, or ask your teacher."],
    ['other_device', 'This admission number is already checked in on another device for this class. Ask your teacher if you need to switch.'],
    ['number_required', 'Enter your admission number too.'],
    ['duplicate_records', 'Your teacher needs to sort out duplicate records. Please try again later.'],
  ]) {
    it(code, async () => {
      const { toast } = await renderSessionPage({
        checkinCard: probeCard,
        api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal(code, message, code === 'number_required' ? 409 : 403)) },
      });
      await click('Check in');
      const notice = await screen.findByTestId('notice');
      expect(notice.textContent).toBe(message);
      expect(notice.dataset.tone).toBe('error');
      expect(toast.showError).not.toHaveBeenCalled();
      // "Try again" is the card's own button.
      expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
    });
  }
});

describe('the code step', () => {
  it('"Send again" waits 60 s; a wrong code says so; no SMS means ask the teacher', async () => {
    const { api } = await renderSessionPage({
      checkinCard: probeCard,
      api: {
        checkinStudent: vi.fn().mockRejectedValueOnce(refusal('verify_required', 'Confirm.')),
        requestCode: vi.fn().mockResolvedValue({ ok: true, deliveryChannel: 'teacher', retryAfterSeconds: 60 }),
        verifyCode: vi.fn().mockRejectedValue(refusal('invalid_code', 'That code is not valid or has expired.', 400)),
      },
    });
    await click('Check in');
    expect((await screen.findByText(/We couldn.t send an SMS right now/)).textContent).toMatch(/Ask your teacher for your code\./);
    const again = await screen.findByRole('button', { name: /Send again in \d+ s/ });
    expect(again.disabled).toBe(true);
    await type('Code', '654321');
    await click('Confirm');
    expect((await screen.findByRole('alert')).textContent).toMatch(/not right, or it has expired/);
    expect(api.requestCode).toHaveBeenCalledTimes(1);
  });
});

describe('registration with a number', () => {
  it('registers with the number, confirms the phone, then checks in with that number by itself', async () => {
    const checkin = vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending });
    const { api, typed } = await renderSessionPage({
      checkinCard: probeCard,
      api: {
        checkinStudent: checkin,
        registerStudentApi: vi.fn().mockResolvedValue({ ok: true, next: 'verify', student: pending }),
        verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 't', next: 'checkin', numberKind: 'student' }),
      },
    });
    await click('Check in');
    typed.regNumber = '5820';
    await click('Register');
    expect(api.registerStudentApi.mock.calls[0][0]).toMatchObject({ number: '5820' });
    expect(await screen.findByTestId('code-step')).toBeTruthy();
    await type('Code', '123456');
    await click('Confirm');
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(checkin.mock.calls.at(-1)[3]).toBe('5820');
  });
});

describe('the check-in card itself', () => {
  beforeEach(() => { unmockSessionPage(); });

  const renderCard = async (props = {}) => {
    const { default: CheckinCard } = await import('@/features/registration/components/CheckinCard.jsx');
    const onSubmit = vi.fn();
    render(<CheckinCard onSubmit={onSubmit} loading={false} {...props} />);
    return onSubmit;
  };

  it('numbers off: phone only, as before', async () => {
    await renderCard();
    expect(screen.queryByLabelText(/Admission number/)).toBeNull();
    expect(screen.queryByTestId('phone-only-toggle')).toBeNull();
  });

  it('numbers on: both fields; "Forgot your number? Ask your teacher."; submits phone and number', async () => {
    const onSubmit = await renderCard({ numbers: true });
    expect(screen.getByText('Forgot your number? Ask your teacher.')).toBeTruthy();
    await type(/Admission number/, 'S-4071');
    await typeTel('0712345678');
    await click('Continue');
    expect(onSubmit).toHaveBeenCalledWith('+254712345678', 'S-4071');
  });

  it('a malformed number is refused on the phone; "phone only" sends none', async () => {
    const onSubmit = await renderCard({ numbers: true });
    await type(/Admission number/, '40');
    await typeTel('0712345678');
    await click('Continue');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your 4-digit admission number/)).toBeTruthy();
    await click(/Check in with your phone only/);
    expect(screen.queryByLabelText(/Admission number/)).toBeNull();
    await click('Continue');
    expect(onSubmit).toHaveBeenCalledWith('+254712345678', '');
  });

  it('refills the phone, shows the notice, focuses the number field', async () => {
    await renderCard({ numbers: true, initialPhone: '+254712345678', focusNumber: true, notice: { tone: 'info', text: 'Your number is 4071.' } });
    await waitFor(() => expect(document.querySelector('input[type="tel"]').value).toBe('712345678'));
    expect(screen.getByRole('status').textContent).toBe('Your number is 4071.');
    expect(document.activeElement).toBe(screen.getByLabelText(/Admission number/));
  });
});
