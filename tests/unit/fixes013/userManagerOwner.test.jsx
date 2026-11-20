import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * 013Fixes / 01 — the superadmin console: the Owner and Developer badges,
 * "Make owner" with a confirmation that names who is replaced, the developer
 * login setting, and a create form with no plan (the plan is the school's).
 */

const api = {
  listUsers: vi.fn(),
  createTeacher: vi.fn().mockResolvedValue({ ok: true }),
  setUserTier: vi.fn(),
  startTrial: vi.fn(),
  setUserDisabled: vi.fn(),
  deleteUser: vi.fn(),
  expireToGrace: vi.fn(),
  expireNow: vi.fn(),
  setOwner: vi.fn().mockResolvedValue({ ok: true }),
  setDevLogin: vi.fn().mockResolvedValue({ ok: true }),
};
vi.mock('@services/api/admin', () => api);
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));

const { default: UserManager } = await import('@features/admin/components/UserManager');

const LIST = {
  ok: true,
  studentCount: 0,
  subscription: { tier: 'gold', status: 'active', grantedBySuperadmin: true },
  ownerUid: 'u-owner',
  devLoginEmail: 'dev@platform.example',
  users: [
    { uid: 'u-admin', email: 'admin@platform.example', role: 'superadmin', isOwner: false, isDeveloper: false },
    { uid: 'u-owner', email: 'owner@school.example', role: 'teacher', isOwner: true, isDeveloper: false },
    { uid: 'u-other', email: 'other@school.example', role: 'teacher', isOwner: false, isDeveloper: false },
    { uid: 'u-dev', email: 'dev@platform.example', role: 'teacher', isOwner: false, isDeveloper: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listUsers.mockResolvedValue(LIST);
});

const row = (email) => screen.getByText(email).closest('tr');

describe('owner and developer in the console', () => {
  it('badges the owner and the developer login', async () => {
    render(<UserManager />);
    await screen.findByText('owner@school.example');
    expect(within(row('owner@school.example')).getByText('Owner')).toBeInTheDocument();
    expect(within(row('dev@platform.example')).getByText('Developer, not counted')).toBeInTheDocument();
    expect(within(row('other@school.example')).queryByText('Owner')).toBeNull();
  });

  it('"Make owner" asks first, names who is replaced, then sets it', async () => {
    render(<UserManager />);
    await screen.findByText('other@school.example');
    expect(within(row('owner@school.example')).queryByRole('button', { name: 'Make owner' })).toBeNull();
    expect(within(row('admin@platform.example')).queryByRole('button', { name: 'Make owner' })).toBeNull();

    fireEvent.click(within(row('other@school.example')).getByRole('button', { name: 'Make owner' }));
    const confirm = screen.getByTestId('owner-confirm');
    expect(confirm.textContent).toMatch(/This replaces owner@school\.example/);
    expect(api.setOwner).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Make owner' }));
    await waitFor(() => expect(api.setOwner).toHaveBeenCalledWith({ uid: 'u-other' }));
  });

  it('saves the developer login email lower-case, and clears it when emptied', async () => {
    render(<UserManager />);
    const input = await screen.findByLabelText(/Developer login/);
    expect(input.value).toBe('dev@platform.example');

    fireEvent.change(input, { target: { value: 'Me@Platform.example' } });
    fireEvent.click(within(screen.getByTestId('dev-login')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setDevLogin).toHaveBeenCalledWith({ devLoginEmail: 'me@platform.example' }));

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(screen.getByTestId('dev-login')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setDevLogin).toHaveBeenLastCalledWith({ devLoginEmail: null }));
  });

  it('the create form has no plan choice and sends none', async () => {
    render(<UserManager />);
    await screen.findByText('owner@school.example');
    fireEvent.click(screen.getByRole('button', { name: /Add teacher/ }));
    expect(screen.queryByLabelText(/Starting tier/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@school.example' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'a-long-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(api.createTeacher).toHaveBeenCalled());
    expect(api.createTeacher.mock.calls[0][0]).not.toHaveProperty('tier');
  });

  it('the plan column shows the SCHOOL\'s plan on every teacher row', async () => {
    render(<UserManager />);
    await screen.findByText('other@school.example');
    for (const email of ['owner@school.example', 'other@school.example', 'dev@platform.example']) {
      expect(within(row(email)).getByRole('combobox').value).toBe('gold');
    }
  });
});
