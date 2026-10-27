import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE, OTHER_PHONE } from './sessionPageHarness';

/**
 * 002Fixes / 07 — the page keeps the pass the server hands back, sends it on
 * repeat checks and joins for the SAME number only, forgets it on "Use a
 * different number", and never puts it in web storage.
 */

const pending = { studentName: 'Amina', approvalStatus: 'pending', blocked: false };
const approved = { studentName: 'Amina', approvalStatus: 'approved', blocked: false, receiptStatus: 'approved' };
const PASS = `v1.1793050000.${'a'.repeat(43)}`;

const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const passesSent = (fn) => fn.mock.calls.map((args) => args[2]);

let storageWrites;
beforeEach(() => {
  vi.resetModules();
  storageWrites = [
    vi.spyOn(Storage.prototype, 'setItem'),
  ];
});
afterEach(() => { cleanup(); unmockSessionPage(); vi.restoreAllMocks(); });

describe('the pass', () => {
  it('is sent on every "Check again" after the check-in that issued it', async () => {
    const { api } = await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: pending, pass: PASS }) },
    });
    await click('Check in');
    await click('Check again');
    await click('Check again');
    expect(passesSent(api.checkinStudent)).toEqual([undefined, PASS, PASS]);
  });

  it('a pass from registering is used by the waiting screen', async () => {
    const { api } = await renderSessionPage({
      api: {
        checkinStudent: vi.fn().mockResolvedValueOnce({ exists: false, student: null }).mockResolvedValue({ exists: true, student: pending }),
        registerStudentApi: vi.fn().mockResolvedValue({ ok: true, student: pending, pass: PASS }),
      },
    });
    await click('Check in');
    await click('Register');
    await click('Check again');
    expect(passesSent(api.checkinStudent)).toEqual([undefined, PASS]);
  });

  it('is sent when joining class', async () => {
    const { api } = await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: approved, pass: PASS }) },
    });
    await click('Check in');
    await click('Join now');
    expect(api.getClassLink).toHaveBeenCalledWith('evening', PHONE, PASS);
  });

  it('is forgotten on "Use a different number", and never sent for another number', async () => {
    const { api, typed } = await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: pending, pass: PASS }) },
    });
    await click('Check in');
    await click('Use a different number');
    typed.phone = OTHER_PHONE;
    await click('Check in');
    expect(api.checkinStudent.mock.calls[1]).toEqual(['evening', OTHER_PHONE, undefined]);
  });

  it('is never written to web storage', async () => {
    await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: pending, pass: PASS }) },
    });
    await click('Check in');
    await click('Check again');
    const written = storageWrites[0].mock.calls.map((c) => c.join('=')).join('\n');
    expect(written).not.toContain(PASS);
  });
});

describe('the API module', () => {
  it('sends the pass as X-Checkin-Pass, and no header without one', async () => {
    unmockSessionPage();
    vi.resetModules();
    const fetch = vi.fn().mockImplementation(async () => new Response('{"exists":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const student = await import('@services/api/student');
    await student.checkinStudent('evening', PHONE, PASS);
    await student.getClassLink('evening', PHONE, PASS);
    await student.checkinStudent('evening', PHONE);
    const headers = fetch.mock.calls.map(([, init]) => init.headers['X-Checkin-Pass']);
    expect(headers).toEqual([PASS, PASS, undefined]);
    vi.unstubAllGlobals();
  });
});
