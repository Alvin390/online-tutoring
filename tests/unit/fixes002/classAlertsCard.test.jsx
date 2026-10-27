import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * 002Fixes / 09 — Superadmin → Notifications → Before-class reminders:
 * where they go (and why), change it, reset it, switch off, send a test.
 */

const api = vi.hoisted(() => ({
  setClassAlertRecipient: vi.fn(),
  resetClassAlertRecipient: vi.fn(),
  setClassAlertsEnabled: vi.fn(),
  sendClassAlertTest: vi.fn(),
}));
vi.mock('@services/api/reports', () => api);

const { default: ClassAlertsSettings } = await import('@/features/reports/components/ClassAlertsSettings.jsx');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const byDefault = { enabled: true, recipient: null, recipients: ['teacher@school.example'], source: 'teacher' };
const renderCard = (initial = byDefault, gmail = true) => render(<ClassAlertsSettings initial={initial} gmailConfigured={gmail} />);
const destination = () => screen.getByTestId('class-alert-destination').textContent;

describe('before-class reminders card', () => {
  it('says where reminders go and why, and that the email is automated', () => {
    renderCard();
    expect(destination()).toMatch(/Going to teacher@school\.example — the teacher's login email \(default\)/);
    expect(screen.getByTestId('class-alerts').textContent).toMatch(/says it is automated and must not be replied to/);
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('change the address', async () => {
    api.setClassAlertRecipient.mockResolvedValue({ ok: true, classAlerts: { enabled: true, recipient: 'alerts@school.example', recipients: ['alerts@school.example'], source: 'set' } });
    renderCard();
    fireEvent.change(screen.getByLabelText('Send reminders to'), { target: { value: 'alerts@school.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(destination()).toMatch(/Going to alerts@school\.example — set here/));
    expect(api.setClassAlertRecipient).toHaveBeenCalledWith('alerts@school.example');
    expect(screen.getByRole('status').textContent).toMatch(/Reminders now go to alerts@school\.example/);
  });

  it('a bad address is caught before sending', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Send reminders to'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(api.setClassAlertRecipient).not.toHaveBeenCalled();
  });

  it('reset to the teacher\'s login email (offered only when an address was set)', async () => {
    api.resetClassAlertRecipient.mockResolvedValue({ ok: true, classAlerts: byDefault });
    renderCard({ enabled: true, recipient: 'alerts@school.example', recipients: ['alerts@school.example'], source: 'set' });
    fireEvent.click(screen.getByRole('button', { name: /Use the teacher's login email/ }));
    await waitFor(() => expect(destination()).toMatch(/teacher@school\.example/));
    expect(screen.queryByRole('button', { name: /Use the teacher's login email/ })).toBeNull();
  });

  it('switch off', async () => {
    api.setClassAlertsEnabled.mockResolvedValue({ ok: true, classAlerts: { ...byDefault, enabled: false } });
    renderCard();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
    expect(api.setClassAlertsEnabled).toHaveBeenCalledWith(false);
    expect(screen.getByRole('status').textContent).toBe('Before-class reminders are off.');
  });

  it('send a test reminder; disabled when Gmail is not set up', async () => {
    api.sendClassAlertTest.mockResolvedValue({ ok: true, sent: true, message: 'Test reminder sent to teacher@school.example.' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Send test reminder/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Test reminder sent to teacher@school.example.'));
    cleanup();
    renderCard(byDefault, false);
    expect(screen.getByRole('button', { name: /Send test reminder/ })).toBeDisabled();
  });
});
