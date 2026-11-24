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

// 014Fixes / 04: the number is GIVEN (tests/unit/fixes014/firstTime.test.jsx
// walks every path); what stays here is that repeat checks carry it.
describe('the first time: phone → confirm → number given → in', () => {
  it('walks the whole way, and the repeat checks carry the number', async () => {
    const checkin = vi.fn()
      .mockRejectedValueOnce(refusal('verify_required', 'Confirm your phone number first.'))
      .mockResolvedValue({ exists: true, student: pending, pass: 'p1' });
    const { api } = await renderSessionPage({
      checkinCard: probeCard,
      api: { checkinStudent: checkin, verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.ticket', next: 'assignNumber', numberKind: 'student' }) },
    });

    await click('Check in');
    expect(await screen.findByTestId('confirm-step')).toBeTruthy();
    expect(api.requestCode).not.toHaveBeenCalled();
    await click('Send code');
    expect(api.requestCode).toHaveBeenCalledTimes(1);
    await type('Code', '123456');
    await click('Confirm');
    expect(api.verifyCode).toHaveBeenCalledWith('evening', PHONE, '123456');
    expect(api.assignNumber).toHaveBeenCalledWith('evening', PHONE, 'v1.ticket');
    await click("I've saved it. Go to class");
    expect(await screen.findByTestId('pending')).toBeTruthy();
    expect(checkin.mock.calls.at(-1).slice(0, 4)).toEqual(['evening', PHONE, undefined, '7319']);

    // "Check again" sends the number too.
    await click('Check again');
    expect(checkin.mock.calls.at(-1)[3]).toBe('7319');
  });

  it('confirmed earlier but no number and no ticket in this visit: a code first', async () => {
    const checkin = vi.fn().mockRejectedValueOnce(refusal('choose_number', 'Choose your admission number to continue.'));
    await renderSessionPage({ checkinCard: probeCard, api: { checkinStudent: checkin } });
    await click('Check in');
    expect(await screen.findByTestId('confirm-step')).toBeTruthy();
  });
});

// 014Fixes / 03: a refused typed number is said on the number step (phone
// first, then the number); the first screen is the phone only.
describe('refusals of a typed number, on the number step (no toast)', () => {
  for (const [code, message, shown] of [
    ['number_mismatch', "That admission number and phone don't match. Check both, or ask your teacher.", true],
    ['other_device', 'Your number is already checked in on another device for this class. You can use this device next class, or ask your teacher to allow this one now.', true],
    ['number_required', 'Enter your admission number too.', false],
    ['duplicate_records', 'Your teacher needs to sort out duplicate records. Please try again later.', true],
  ]) {
    it(code, async () => {
      const { toast } = await renderSessionPage({
        checkinCard: probeCard,
        api: { checkinStudent: vi.fn().mockRejectedValueOnce(refusal(code, message, code === 'number_required' ? 409 : 403)) },
      });
      await click('Check in');
      await screen.findByTestId('number-step');
      if (shown) expect(screen.getByRole('alert').textContent).toBe(message);
      else expect(screen.queryByRole('alert')).toBeNull();
      expect(toast.showError).not.toHaveBeenCalled();
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
    await click('Send code'); // 014Fixes / 04: sent only on the tap
    expect((await screen.findByText(/We couldn.t send an SMS right now/)).textContent).toMatch(/Ask your teacher for your code\./);
    const again = await screen.findByRole('button', { name: /Send again in \d+ s/ });
    expect(again.disabled).toBe(true);
    await type('Code', '654321');
    await click('Confirm');
    expect((await screen.findByRole('alert')).textContent).toBe('That code is not valid or has expired.');
    expect(api.requestCode).toHaveBeenCalledTimes(1);
  });
});

// 014Fixes / 02: registration no longer answers next 'verify' (code first,
// the number given): tests/unit/fixes014/registerSteps.test.jsx (phase 06).

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

  // 014Fixes / 03: the number has its own step (tests/unit/fixes014/phoneFirst.test.jsx).
  it('numbers on: the phone only, too; submits the phone alone', async () => {
    const onSubmit = await renderCard({ numbers: true });
    expect(screen.queryByLabelText(/Admission number/)).toBeNull();
    await typeTel('0712345678');
    await click('Continue');
    expect(onSubmit).toHaveBeenCalledWith('+254712345678');
  });

  it('refills the phone and shows the notice', async () => {
    await renderCard({ numbers: true, initialPhone: '+254712345678', notice: { tone: 'info', text: 'Your number is 4071.' } });
    await waitFor(() => expect(document.querySelector('input[type="tel"]').value).toBe('712345678'));
    expect(screen.getByRole('status').textContent).toBe('Your number is 4071.');
  });
});
