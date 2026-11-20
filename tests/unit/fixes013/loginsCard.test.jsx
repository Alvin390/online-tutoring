import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { BillingContext } from '@features/billing/context/billingContextValue';

/**
 * 013Fixes / 10 — the owner's "Dashboard logins" card in Setup: shown to the
 * owner only; seats; greyed at the limit with "Contact us for more"; add,
 * disable/enable, remove (email typed back); plain errors.
 */

const api = vi.hoisted(() => ({
  listLogins: vi.fn(), addLogin: vi.fn(), disableLogin: vi.fn(), enableLogin: vi.fn(), removeLogin: vi.fn(),
}));
vi.mock('@services/api/logins', () => api);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useOptionalToast: () => toast, useToast: () => toast }));
vi.mock('@features/dashboard/components/SessionManager', () => ({ default: () => <div data-testid="sessions" /> }));
vi.mock('@features/dashboard/components/ClassLinkManager', () => ({ default: () => <div data-testid="links" /> }));
vi.mock('@features/auth/context/AuthContext', () => ({ useAuthState: () => ({ tier: 'silver', tierRank: 2, isSuperadmin: false }) }));

const { default: SetupTab } = await import('@features/dashboard/tabs/SetupTab');
const { default: LoginsCard } = await import('@features/dashboard/components/logins/LoginsCard');

const LOGINS = (over = {}) => ({
  logins: [
    { uid: 'o', email: 'owner@school.example', displayName: 'Owner', disabled: false, isOwner: true, isDeveloper: false },
    { uid: 'a', email: 'a@school.example', displayName: 'Asha', disabled: false, isOwner: false, isDeveloper: false },
    { uid: 'b', email: 'b@school.example', displayName: 'Ben', disabled: true, isOwner: false, isDeveloper: false },
    { uid: 'd', email: 'dev@platform.example', displayName: 'Support', disabled: false, isOwner: false, isDeveloper: true },
  ],
  seats: { used: 2, included: 5, extra: 0, limit: 5 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listLogins.mockResolvedValue(LOGINS());
  api.addLogin.mockResolvedValue({ ok: true });
  api.disableLogin.mockResolvedValue({ ok: true });
  api.enableLogin.mockResolvedValue({ ok: true });
  api.removeLogin.mockResolvedValue({ ok: true });
});

const setup = (isOwner) => render(
  <BillingContext.Provider value={{ loading: false, plan: { tier: 'silver', features: { sessions: true }, limits: {}, isOwner } }}>
    <SetupTab sessions={[]} classLinks={{}} onUpdateLink={vi.fn()} loading={false} />
  </BillingContext.Provider>
);

describe('who sees it', () => {
  it('the owner sees the logins card', async () => {
    setup(true);
    expect(await screen.findByTestId('logins-card')).toBeTruthy();
    expect(screen.getByTestId('seat-count').textContent).toBe('Seats: 2 of 5 used');
  });

  it('other teachers see nothing, and nothing is asked of the server', async () => {
    setup(false);
    await screen.findByTestId('sessions');
    expect(screen.queryByTestId('logins-card')).toBeNull();
    expect(api.listLogins).not.toHaveBeenCalled();
  });
});

describe('the card', () => {
  it('the owner and the support login have no buttons; others can be disabled, enabled and removed', async () => {
    render(<LoginsCard />);
    const card = await screen.findByTestId('logins-card');
    const row = (email) => within(card).getByText(email).closest('li');
    expect(within(row('owner@school.example')).queryByRole('button')).toBeNull();
    expect(within(row('dev@platform.example')).queryByRole('button')).toBeNull();
    await act(async () => { fireEvent.click(within(row('a@school.example')).getByRole('button', { name: 'Disable' })); });
    expect(api.disableLogin).toHaveBeenCalledWith('a');
    await act(async () => { fireEvent.click(within(row('b@school.example')).getByRole('button', { name: 'Enable' })); });
    expect(api.enableLogin).toHaveBeenCalledWith('b');
  });

  it('adds a login with the name, email and password', async () => {
    render(<LoginsCard />);
    await screen.findByTestId('logins-card');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Carol' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'c@school.example' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'a-long-password-123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add login' })); });
    expect(api.addLogin).toHaveBeenCalledWith({ displayName: 'Carol', email: 'c@school.example', password: 'a-long-password-123' });
    expect(toast.showSuccess).toHaveBeenCalledWith(expect.stringMatching(/Login added for c@school\.example/));
  });

  it('refuses a short password before sending', async () => {
    render(<LoginsCard />);
    await screen.findByTestId('logins-card');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'c@school.example' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add a login' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/at least 12 characters/);
    expect(api.addLogin).not.toHaveBeenCalled();
  });

  it('says a used email plainly', async () => {
    api.addLogin.mockRejectedValue(Object.assign(new Error('x'), { code: 'email_taken' }));
    render(<LoginsCard />);
    await screen.findByTestId('logins-card');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@school.example' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'a-long-password-123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add login' })); });
    expect(screen.getByRole('alert').textContent).toBe('A login with that email already exists.');
  });

  it('at the limit the form is greyed out with "Contact us for more"; a disabled login can\'t be re-enabled', async () => {
    api.listLogins.mockResolvedValue(LOGINS({ seats: { used: 5, included: 5, extra: 0, limit: 5 } }));
    render(<LoginsCard />);
    await screen.findByTestId('logins-card');
    expect(screen.getByTestId('seat-full').textContent).toBe('Your plan includes 5 logins. Contact us for more.');
    expect(screen.getByRole('button', { name: 'Add login' }).closest('fieldset').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Enable' }).disabled).toBe(true);
  });

  it('remove asks for the email typed back', async () => {
    render(<LoginsCard />);
    const card = await screen.findByTestId('logins-card');
    fireEvent.click(within(within(card).getByText('a@school.example').closest('li')).getByRole('button', { name: 'Remove' }));
    const confirm = screen.getByTestId('remove-confirm');
    const button = within(confirm).getByRole('button', { name: 'Remove login' });
    expect(button.disabled).toBe(true);
    fireEvent.change(within(confirm).getByLabelText(/to confirm/), { target: { value: 'A@school.example' } });
    expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(api.removeLogin).toHaveBeenCalledWith('a', 'A@school.example'));
  });
});
