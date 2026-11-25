import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MaintenanceGate from '@shared/components/MaintenanceGate';
import { modesStore } from '@/shared/config/modesStore';

/**
 * 013Fixes / 34 — the maintenance screen: students and teachers see "Under
 * maintenance" (with the message and the expected end) while it is on; the
 * superadmin page never does. An API answer of 503 `maintenance` shows it at
 * once, without waiting for the next bootstrap.
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminModes', () => ({
  getModes: (...a) => api.getModes(...a),
  setPaymentsMode: vi.fn(),
  setSmsMode: vi.fn(),
  setMaintenance: (...a) => api.setMaintenance(...a),
}));

const UNTIL = Date.parse('2026-12-01T09:00:00Z');
const at = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <MaintenanceGate><div data-testid="app">the app</div></MaintenanceGate>
  </MemoryRouter>
);

beforeEach(() => { modesStore.__reset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the maintenance gate', () => {
  it('off: the app', () => {
    at('/evening');
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('on: students and teachers see the screen, the message and when it is expected back', () => {
    act(() => modesStore.setFromRemote({ maintenance: { message: 'Upgrading the class links.', until: UNTIL } }));
    for (const path of ['/', '/evening', '/dashboard']) {
      at(path);
      expect(screen.getByTestId('maintenance-screen').textContent).toMatch(/Under maintenance, back soon/);
      expect(screen.getByTestId('maintenance-message').textContent).toBe('Upgrading the class links.');
      expect(screen.getByTestId('maintenance-until').textContent).toMatch(/Expected back: .*1 Dec/);
      expect(screen.queryByTestId('app')).toBeNull();
      cleanup();
    }
  });

  it('the superadmin page is never covered', () => {
    act(() => modesStore.setFromRemote({ maintenance: { message: null, until: null } }));
    at('/superadmin');
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('an API answer of 503 maintenance shows it at once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'maintenance', message: 'Back at 9.' } }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const { apiPost } = await import('@/services/api/client');
    await expect(apiPost('/api/student/checkin', { session: 'evening' }, { retry: 0 })).rejects.toMatchObject({ code: 'maintenance' });
    expect(modesStore.get().maintenance).toMatchObject({ message: 'Back at 9.' });
  });
});

describe('the Modes card: maintenance', () => {
  const view = (maintenance) => ({
    payments: { mode: 'test', source: 'env', liveKeys: true }, sms: { mode: 'real', source: 'env' }, maintenance, paidPeriod: false,
  });

  it('switch on with a message and an end time; shown in red; switch off', async () => {
    api.getModes = vi.fn().mockResolvedValue(view({ on: false, message: null, until: null }));
    api.setMaintenance = vi.fn(async ({ on, message, until }) => view(on ? { on, message, until } : { on: false, message: null, until: null }));
    const { default: ModesCard } = await import('@/features/admin/components/ModesCard');
    render(<ModesCard />);
    await act(async () => {});
    expect(screen.getByTestId('maintenance-badge').textContent).toBe('Off');
    fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'Upgrading the class links.' } });
    fireEvent.change(screen.getByLabelText('Expected back (optional)'), { target: { value: '2026-12-01T12:00' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch on' })); });
    expect(api.setMaintenance).toHaveBeenCalledWith({ on: true, message: 'Upgrading the class links.', until: new Date('2026-12-01T12:00').getTime() });
    expect(screen.getByTestId('maintenance-badge').textContent).toBe('On');
    expect(screen.getByTestId('maintenance-on').textContent).toMatch(/Upgrading the class links/);
    expect(modesStore.get().maintenance).toMatchObject({ message: 'Upgrading the class links.' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch off' })); });
    expect(api.setMaintenance).toHaveBeenLastCalledWith({ on: false });
    expect(screen.getByTestId('maintenance-badge').textContent).toBe('Off');
    expect(modesStore.get().maintenance).toBeNull();
  });
});
