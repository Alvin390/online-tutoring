import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 007Fixes / 10 — the Staff tab (owner, 2026-11-11): "if they are teachers,
 * there's a place for the staff". Name, phone, session, subjects taught; edit,
 * back to student, delete, message one. And WhatsApp gains "Send to: Staff".
 */

const api = vi.hoisted(() => ({ unmarkStaff: vi.fn() }));
vi.mock('@services/api/students', () => api);
const wa = vi.hoisted(() => ({
  createCampaign: vi.fn(), getCampaign: vi.fn(), listCampaigns: vi.fn(), markRecipient: vi.fn(), completeCampaign: vi.fn(),
  abandonCampaign: vi.fn(), deleteCampaign: vi.fn(), uploadAttachment: vi.fn(), getCampaignOptions: vi.fn(),
}));
vi.mock('@services/api/whatsapp', () => wa);
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tierRank: 3, isSuperadmin: false }) }));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useOptionalToast: () => null }));

const since = { toDate: () => new Date('2026-11-12T08:00:00Z') };
const STAFF = {
  morning: [{ id: '+254700000469', studentName: 'Brian Juma', class: 'Form 3', subjects: 'English, Mathematics', staff: true, staffAt: since }],
  evening: [
    { id: '+254700000544', studentName: 'Brian Kiplimo', class: 'Form 3', subjects: 'Kiswahili', staff: true, staffAt: since },
    { id: '+254700000618', studentName: 'Cecilia', class: 'Grade 7', subjects: 'English', staff: true, staffAt: since },
  ],
};
const SESSIONS = [{ id: 'morning', name: 'Morning', classes: ['Form 3'] }, { id: 'evening', name: 'Evening', classes: ['Form 3', 'Grade 7'] }];

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(wa)]) fn.mockReset();
  api.unmarkStaff.mockResolvedValue({ unmarked: 1, skipped: [] });
  wa.listCampaigns.mockResolvedValue({ campaigns: [] });
  wa.getCampaignOptions.mockResolvedValue({ sessions: [], classes: [], students: [] });
  sessionStorage.clear();
});
afterEach(() => cleanup());

async function staffTab(props = {}) {
  const { default: StaffTab } = await import('@features/dashboard/tabs/StaffTab');
  const onEdit = vi.fn().mockResolvedValue({ success: true });
  const onDelete = vi.fn().mockResolvedValue({ success: true });
  render(<MemoryRouter><StaffTab staffBySession={STAFF} sessions={SESSIONS} onEdit={onEdit} onDelete={onDelete} {...props} /></MemoryRouter>);
  return { onEdit, onDelete };
}
const rows = () => screen.queryAllByTestId('staff-row');
const rowOf = (name) => rows().find((r) => r.textContent.includes(name));

describe('the list', () => {
  it('everyone marked as staff, across sessions, with session, subjects taught and since when', async () => {
    await staffTab();
    expect(screen.getByRole('heading', { name: /Staff \(3\)/ })).toBeTruthy();
    expect(rows()).toHaveLength(3);
    const brian = rowOf('Brian Juma');
    expect(brian.textContent).toMatch(/Morning/);
    expect(brian.textContent).toMatch(/English, Mathematics/);
    expect(brian.textContent).toMatch(/\+254700000469/);
    expect(brian.textContent).toMatch(/12 Nov 2026/);
  });

  it('search by name or number, and filter by session', async () => {
    await staffTab();
    const search = screen.getByRole('searchbox', { name: /Search staff/ });
    fireEvent.change(search, { target: { value: 'kiplimo' } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringMatching(/Brian Kiplimo/)]);
    fireEvent.change(search, { target: { value: '618' } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringMatching(/Cecilia/)]);
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: /Session/ }), { target: { value: 'evening' } });
    expect(rows()).toHaveLength(2);
  });

  it('no staff: says how to add one', async () => {
    await staffTab({ staffBySession: {} });
    expect(screen.getByText(/No staff yet\. To add a teacher, open them in Students and switch on .This is a teacher \(staff\)./)).toBeTruthy();
  });
});

describe('what can be done to one', () => {
  it('Edit: name, phone and subjects only (no class, no M-Pesa message), through the existing update', async () => {
    const { onEdit } = await staffTab();
    fireEvent.click(within(rowOf('Brian Juma')).getByRole('button', { name: /Edit/ }));
    const dialog = screen.getByRole('dialog', { name: /Edit Brian Juma/ });
    expect(within(dialog).getByLabelText(/Name/)).toBeTruthy();
    expect(within(dialog).getByLabelText(/Phone/)).toBeTruthy();
    expect(dialog.textContent).toMatch(/Subjects taught/);
    expect(dialog.textContent).not.toMatch(/Payment Receipt|M-Pesa/);
    expect(within(dialog).queryByLabelText(/^Class/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Brian J. Juma' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    expect(onEdit).toHaveBeenCalledWith('morning', '+254700000469',
      expect.objectContaining({ studentName: 'Brian J. Juma', subjects: 'English, Mathematics' }), '+254700000469');
    const [, , form] = onEdit.mock.calls[0];
    expect(form).not.toHaveProperty('class');
    expect(form).not.toHaveProperty('receiptMessage');
  });

  it('Back to student: says what it means, then unmarks', async () => {
    await staffTab();
    fireEvent.click(within(rowOf('Brian Juma')).getByRole('button', { name: /Back to student/ }));
    const dialog = screen.getByRole('dialog', { name: /Set Brian Juma back to student\?/ });
    expect(dialog.textContent).toMatch(/Brian Juma will be counted as a student again\. They can be blocked and charged like other students\. Their closed balance stays closed\./);
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Back to student' })); });
    expect(api.unmarkStaff).toHaveBeenCalledWith([{ session: 'morning', phone: '+254700000469' }]);
  });

  it('Delete: confirms, then the existing delete', async () => {
    const { onDelete } = await staffTab();
    fireEvent.click(within(rowOf('Cecilia')).getByRole('button', { name: /Delete/ }));
    const dialog = screen.getByRole('dialog', { name: /Delete Cecilia\?/ });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })); });
    expect(onDelete).toHaveBeenCalledWith('evening', '+254700000618', 'Cecilia');
  });

  it('Message: a WhatsApp link to that one number', async () => {
    await staffTab();
    const link = within(rowOf('Brian Kiplimo')).getByRole('link', { name: /Message Brian Kiplimo on WhatsApp/ });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/254700000544/);
    expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('WhatsApp: Send to Staff', () => {
  it('"Staff" is a choice; it sends to all staff (no list to tick) as filter type "staff"', async () => {
    wa.createCampaign.mockResolvedValue({ ok: true, campaignId: 'C1', recipientCount: 3 });
    wa.getCampaign.mockResolvedValue({ campaign: { id: 'C1', status: 'in_progress' }, recipients: [] });
    const { default: WhatsAppPanel } = await import('@features/whatsapp/components/WhatsAppPanel.jsx');
    render(<WhatsAppPanel />);
    const sendTo = screen.getByDisplayValue('All students');
    expect([...sendTo.options].map((o) => o.textContent)).toContain('Staff (teachers)');
    fireEvent.change(sendTo, { target: { value: 'staff' } });
    expect(screen.queryByText(/Choose at least one/)).toBeNull();
    expect(wa.getCampaignOptions).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Campaign name/), { target: { value: 'Staff meeting' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Staff meeting at 5 pm.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Review recipients/ })); });
    expect(wa.createCampaign).toHaveBeenCalledWith(expect.objectContaining({ filter: expect.objectContaining({ type: 'staff', values: [] }) }));
  });
});

describe('the tab', () => {
  it('Staff sits after WhatsApp, always shown; on a phone it is under More', async () => {
    const { DASHBOARD_TABS, visibleTabs } = await import('@features/dashboard/nav/dashboardTabs');
    expect(DASHBOARD_TABS.map((t) => t.id)).toEqual(['students', 'approvals', 'fees', 'whatsapp', 'staff', 'calendar', 'setup']);
    expect(visibleTabs(() => false).map((t) => t.id)).toEqual(['students', 'staff', 'setup']);
    // The phone bar takes the first four visible tabs; with every flag on, Staff is under More.
    expect(visibleTabs(() => true).slice(4).map((t) => t.id)).toEqual(['staff', 'calendar', 'setup']);
  });
});
