import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 008Fixes / 10 — the SMS button on staff rows (owner, HashBack answer 10):
 * a small pop-up with the box, the placeholder buttons and the counter;
 * sendOne; "Sent" then "Delivered"; locked until SMS is set up. Shown with
 * sms.enabled for Silver and up.
 */

const sms = vi.hoisted(() => ({ getSmsSetup: vi.fn(), sendSmsToOne: vi.fn(), refreshSms: vi.fn() }));
vi.mock('@services/api/sms', () => sms);
vi.mock('@services/api/students', () => ({ unmarkStaff: vi.fn() }));
const auth = vi.hoisted(() => ({ tierRank: 2, isSuperadmin: false }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => auth }));
const flags = vi.hoisted(() => ({ 'sms.enabled': true }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));
vi.mock('@/context/ToastContext', () => ({ useOptionalToast: () => null, useToast: () => ({}) }));

const STAFF = { evening: [{ id: '+254711000009', studentName: 'Mwalimu Juma', class: 'Form 3', staff: true }] };
const unlocked = { setup: { schoolName: 'Focus', unlocked: true, sender: 'HASHBACKSMS' } };

async function renderTab() {
  const { default: StaffTab } = await import('@features/dashboard/tabs/StaffTab');
  render(<MemoryRouter><StaffTab sessions={[{ id: 'evening', name: 'Evening' }]} staffBySession={STAFF} onEdit={vi.fn()} onDelete={vi.fn()} /></MemoryRouter>);
}
const open = async () => {
  const button = await screen.findByRole('button', { name: 'SMS Mwalimu Juma' });
  await act(async () => { fireEvent.click(button); });
  return screen.findByRole('dialog');
};

beforeEach(() => {
  for (const fn of Object.values(sms)) fn.mockReset();
  sms.getSmsSetup.mockResolvedValue(unlocked);
  auth.tierRank = 2;
  flags['sms.enabled'] = true;
});
afterEach(() => cleanup());

describe('the button', () => {
  it('shown with SMS on for Silver; not with SMS off, nor for Bronze', async () => {
    await renderTab();
    expect(screen.getByRole('button', { name: 'SMS Mwalimu Juma' })).toBeTruthy();
    cleanup();
    flags['sms.enabled'] = false;
    await renderTab();
    expect(screen.queryByRole('button', { name: 'SMS Mwalimu Juma' })).toBeNull();
    cleanup();
    flags['sms.enabled'] = true;
    auth.tierRank = 1;
    await renderTab();
    expect(screen.queryByRole('button', { name: 'SMS Mwalimu Juma' })).toBeNull();
  });
});

describe('the pop-up', () => {
  it('name and phone ending; placeholder buttons; the counter; Send sends their own message', async () => {
    sms.sendSmsToOne.mockResolvedValue({ campaignId: 'one1', sent: 1, units: 1, cost: 0.35 });
    await renderTab();
    const dialog = await open();
    expect(dialog.textContent).toMatch(/SMS to Mwalimu Juma/);
    expect(dialog.textContent).toMatch(/To …009/);
    await screen.findByLabelText('Message');
    expect(screen.queryByRole('button', { name: 'Class reminder' })).toBeNull(); // no parent starters here
    await act(async () => { fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello ' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Student name' })); });
    expect(screen.getByLabelText('Message').value).toBe('Hello [Student name]');
    // "Hello Mwalimu Juma" = 18 characters.
    expect(screen.getByTestId('staff-sms-counter').textContent).toBe('18 / 336 characters · 1 SMS'); // 009Fixes / 00: no price
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send SMS' })); });
    expect(sms.sendSmsToOne).toHaveBeenCalledWith('evening', '+254711000009', 'Hello {{studentName}}');
    expect((await screen.findByTestId('staff-sms-status')).textContent).toMatch(/^Sent/);
  });

  it('[Session] counts with the real session name, as the server fills it', async () => {
    await renderTab();
    await open();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'See you in [Session]' } }); });
    // "See you in Evening" = 18 characters (an empty session name would give 11).
    expect(screen.getByTestId('staff-sms-counter').textContent).toMatch(/^18 \/ 336 characters/);
  });

  it('over two SMS: says by how much, and Send is disabled', async () => {
    await renderTab();
    await open();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'x'.repeat(340) } }); });
    expect(screen.getByTestId('staff-sms-counter').textContent).toMatch(/Shorten it by 4 characters\./);
    expect(screen.getByRole('button', { name: 'Send SMS' }).disabled).toBe(true);
  });

  it('emoji removed as typed', async () => {
    await renderTab();
    await open();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Asante 🙏' } }); });
    expect(screen.getByLabelText('Message').value).toBe('Asante ');
  });

  it('reopened: asks HashBack again and shows Delivered', async () => {
    sms.sendSmsToOne.mockResolvedValue({ campaignId: 'one2', sent: 1 });
    sms.refreshSms.mockResolvedValue({ campaign: { id: 'one2' }, recipients: [{ id: 'r', status: 'delivered' }] });
    await renderTab();
    await open();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Hi' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send SMS' })); });
    await screen.findByTestId('staff-sms-status');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    await open();
    await waitFor(() => expect(screen.getByTestId('staff-sms-status').textContent).toMatch(/^Delivered/));
    expect(sms.refreshSms).toHaveBeenCalledWith('one2');
  });

  it('a refusal shows the server\'s words', async () => {
    sms.sendSmsToOne.mockRejectedValue(new Error('SMS credit is low. Messages are paused so check-in codes keep working.'));
    await renderTab();
    await open();
    await act(async () => { fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Hi' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send SMS' })); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/check-in codes keep working/);
  });

  it('locked until SMS is set up, with a link to Messages', async () => {
    sms.getSmsSetup.mockResolvedValue({ setup: { schoolName: '', unlocked: false } });
    await renderTab();
    await open();
    expect((await screen.findByRole('status')).textContent).toMatch(/Set up SMS first/);
    expect(screen.getByRole('link', { name: 'Open Messages' }).getAttribute('href')).toBe('/dashboard/whatsapp');
    expect(screen.queryByRole('button', { name: 'Send SMS' })).toBeNull();
  });
});
