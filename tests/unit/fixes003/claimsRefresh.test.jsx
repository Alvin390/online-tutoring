import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

/**
 * 003Fixes / 01 — a claims refresh that fails must keep the claims we already
 * have. It used to replace them with "no role, no plan", which turned every
 * plan-gated panel (Fees, Calendar, WhatsApp) into an upgrade prompt until the
 * next reload.
 */

let userDocListener;
const user = { uid: 't1', getIdTokenResult: vi.fn() };

beforeEach(() => {
  vi.resetModules();
  user.getIdTokenResult.mockReset()
    .mockResolvedValueOnce({ claims: { role: 'teacher', tier: 'gold', tierRank: 3, subActive: true } })
    .mockRejectedValue(Object.assign(new Error('network'), { code: 'auth/network-request-failed' }));
  vi.doMock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})),
    onSnapshot: vi.fn((_ref, next) => { userDocListener = next; return () => {}; }),
  }));
  vi.doMock('@services/firebase/auth', () => ({
    onAuthChange: vi.fn((cb) => { cb(user); return () => {}; }),
    signIn: vi.fn(), signOut: vi.fn(),
  }));
  vi.doMock('@services/firebase/config', () => ({ auth: { currentUser: user }, db: {}, wipeLocalData: vi.fn() }));
  vi.doMock('@utils/analytics', () => ({ trackLogin: vi.fn() }));
  vi.doMock('@services/api/auth', () => ({ recordLoginAttempt: vi.fn() }));
});
afterEach(() => {
  cleanup();
  for (const m of ['firebase/firestore', '@services/firebase/auth', '@services/firebase/config', '@utils/analytics', '@services/api/auth']) vi.doUnmock(m);
});

const stamp = (ms) => ({ exists: () => true, data: () => ({ claimsUpdatedAt: { toMillis: () => ms } }) });

it('keeps the plan when a server-triggered token refresh fails', async () => {
  const { AuthProvider, useAuthState, useAuthActions } = await import('@features/auth/context/AuthContext.jsx');
  const { result } = renderHook(() => ({ state: useAuthState(), actions: useAuthActions() }), { wrapper: AuthProvider });
  await act(async () => {});
  expect(result.current.state.tierRank).toBe(3);

  await act(async () => { userDocListener(stamp(1)); });
  await act(async () => { userDocListener(stamp(2)); }); // a claim change → forced refresh → fails
  expect(result.current.state.tierRank).toBe(3);
  expect(result.current.state.tier).toBe('gold');

  await act(async () => { await result.current.actions.refreshClaims(); });
  expect(result.current.state.tierRank).toBe(3);
});
