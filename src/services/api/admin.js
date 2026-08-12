import { apiPost } from './client';

/**
 * Superadmin console calls.
 *
 * Every one of these requires a verified superadmin ID token; the handler
 * checks the claim server-side, so a teacher calling these directly gets 403
 * regardless of what the UI shows.
 */

export const listUsers = () => apiPost('/api/admin/users', { action: 'list' });

export const createTeacher = ({ email, password, displayName, tier }) =>
  apiPost('/api/admin/users', { action: 'createTeacher', email, password, displayName, tier });

export const setUserRole = ({ uid, role, tier }) =>
  apiPost('/api/admin/users', { action: 'setRole', uid, role, tier });

export const setUserTier = ({ uid, tier }) =>
  apiPost('/api/admin/users', { action: 'setTier', uid, tier });

export const startTrial = ({ uid, tier, trialDays }) =>
  apiPost('/api/admin/users', { action: 'startTrial', uid, tier, trialDays });

export const setUserDisabled = ({ uid, disabled }) =>
  apiPost('/api/admin/users', { action: disabled ? 'disable' : 'enable', uid });

/** Irreversible. `confirmEmail` must match the target exactly. */
export const deleteUser = ({ uid, confirmEmail }) =>
  apiPost('/api/admin/users', { action: 'delete', uid, confirmEmail });
