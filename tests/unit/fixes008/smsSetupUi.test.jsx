import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

/**
 * 008Fixes / 08 — SMS is locked until set up: the school name, a test to her
 * phone, "Did it arrive?" → unlock; then a one-time notice about the shared
 * sender; Setup lets the name change later. And the quiet reload: errors
 * while the page reloads onto a new version are not reported.
 */

const api = vi.hoisted(() => ({ getSmsSetup: vi.fn(), saveSchoolName: vi.fn(), sendSmsTest: vi.fn(), unlockSms: vi.fn() }));
vi.mock('@services/api/sms', () => api);

const locked = { schoolName: '', unlocked: false, sender: 'HASHBACKSMS' };
const unlocked = { schoolName: 'Focus School', unlocked: true, sender: 'HASHBACKSMS' };
// Find first, then act: waiting for an element INSIDE act() holds back the update that shows it.
const click = async (name) => {
  const button = await screen.findByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
};
const type = async (label, value) => {
  const input = await screen.findByLabelText(label);
  await act(async () => { fireEvent.change(input, { target: { value } }); });
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  try { localStorage.removeItem('ot.smsSenderNotice.v1'); } catch { /* none */ }
});
afterEach(() => cleanup());

async function renderArea() {
  const { default: MessagesArea } = await import('@features/sms/components/MessagesArea');
  render(<MessagesArea>{(setup) => <div data-testid="composer">composer for {setup.schoolName}</div>}</MessagesArea>);
}

describe('locked until set up', () => {
  it('name → test → arrived → unlocked, with the sender notice once', async () => {
    api.getSmsSetup.mockResolvedValue({ setup: locked });
    api.saveSchoolName.mockResolvedValue({ setup: { ...locked, schoolName: 'Focus School' } });
    api.sendSmsTest.mockResolvedValue({ sent: true, phoneEnding: '678', sender: 'HASHBACKSMS' });
    api.unlockSms.mockResolvedValue({ setup: unlocked });
    await renderArea();

    expect(await screen.findByText('Set up SMS first')).toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send test' }).disabled).toBe(true); // name first

    await type('School name', 'Focus School');
    await click('Save');
    expect(api.saveSchoolName).toHaveBeenCalledWith('Focus School');
    await act(async () => { fireEvent.change(document.querySelector('input[type="tel"]'), { target: { value: '0712345678' } }); });
    await click('Send test');
    expect(api.sendSmsTest).toHaveBeenCalledWith('+254712345678');
    expect(screen.getByText(/Sent to the number ending 678/)).toBeTruthy();

    await click('Yes, it arrived');
    expect(await screen.findByTestId('composer')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toMatch(/HASHBACKSMS, a shared sender/);
    await click('Got it');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('ot.smsSenderNotice.v1')).toBe('1');
  });

  it('"No": try again, and who to ask', async () => {
    api.getSmsSetup.mockResolvedValue({ setup: { ...locked, schoolName: 'Focus' } });
    api.sendSmsTest.mockResolvedValue({ sent: true, phoneEnding: '678' });
    await renderArea();
    await screen.findByText('Set up SMS first');
    await act(async () => { fireEvent.change(document.querySelector('input[type="tel"]'), { target: { value: '0712345678' } }); });
    await click('Send test');
    await click('No');
    expect(screen.getByRole('status').textContent).toMatch(/Send again.*ask the owner to check the SMS credit/s);
    expect(api.unlockSms).not.toHaveBeenCalled();
  });

  it('a name with emoji is refused before saving', async () => {
    api.getSmsSetup.mockResolvedValue({ setup: locked });
    await renderArea();
    await type('School name', 'Focus 🌟');
    expect(screen.getByText(/SMS can.t carry 🌟/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });
});

describe('the phone field', () => {
  it('takes a Kenyan mobile number in any usual form', async () => {
    const { kenyanMobile } = await import('@features/sms/components/SmsSetup');
    for (const typed of ['0712345678', '712345678', '+254712345678', '254 712 345 678', '0112 345 678']) {
      expect(kenyanMobile(typed), typed).toMatch(/^\+254[17]\d{8}$/);
    }
    for (const typed of ['', '071234567', '0812345678', '+1 555 0100']) expect(kenyanMobile(typed), typed).toBeNull();
  });
});

describe('unlocked', () => {
  it('shows the composer; Setup changes the name without locking', async () => {
    api.getSmsSetup.mockResolvedValue({ setup: unlocked });
    api.saveSchoolName.mockResolvedValue({ setup: { ...unlocked, schoolName: 'Focus Academy' } });
    await renderArea();
    expect((await screen.findByTestId('composer')).textContent).toBe('composer for Focus School');
    expect(screen.queryByRole('dialog')).toBeNull(); // the notice is for the moment of unlocking
    await click('Setup');
    await type('School name', 'Focus Academy');
    await click('Save');
    await waitFor(() => expect(screen.getByTestId('composer').textContent).toBe('composer for Focus Academy'));
    expect(screen.queryByText('Set up SMS first')).toBeNull();
  });
});

describe('the quiet reload (Sentry ONLINE-TUTORING-1-E)', () => {
  it('a reload onto a new version marks the page; monitoring drops errors then, and only then', async () => {
    vi.resetModules();
    const chunk = await import('@utils/chunkReload');
    const { prepareEvent } = await import('@utils/monitoring');
    chunk.__resetChunkReloading();
    const event = { exception: { values: [{ type: 'TypeError', value: "Cannot read properties of undefined (reading 'default')" }] } };
    expect(prepareEvent(event, {})).not.toBeNull();

    const win = new EventTarget();
    win.sessionStorage = { getItem: () => null, setItem: () => {} };
    win.location = { reload: vi.fn() };
    chunk.installChunkReload(win);
    const preload = new Event('vite:preloadError', { cancelable: true });
    win.dispatchEvent(preload);
    expect(win.location.reload).toHaveBeenCalled();
    expect(chunk.isChunkReloading()).toBe(true);
    expect(prepareEvent(event, {})).toBeNull();
    chunk.__resetChunkReloading();
  });

  it('inside the 30 s loop window there is no reload, so errors are still reported', async () => {
    vi.resetModules();
    const chunk = await import('@utils/chunkReload');
    const { prepareEvent } = await import('@utils/monitoring');
    const win = new EventTarget();
    win.sessionStorage = { getItem: () => String(Date.now()), setItem: () => {} };
    win.location = { reload: vi.fn() };
    chunk.installChunkReload(win);
    win.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(prepareEvent({ message: 'x' }, {})).not.toBeNull();
  });

  it('the PDF export returns quietly (null) when the libraries come back empty, as Vite gives them during the reload', async () => {
    const { buildStudentsPdf } = await import('@features/dashboard/hooks/studentsPdf');
    await expect(buildStudentsPdf({
      sessionName: 'Evening', students: [], loadLibraries: async () => [undefined, undefined],
    })).resolves.toBeNull();
  });
});
