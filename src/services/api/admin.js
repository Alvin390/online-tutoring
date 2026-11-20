import { apiPost } from './client';

/**
 * Superadmin console calls.
 *
 * Every one of these requires a verified superadmin ID token; the handler
 * checks the claim server-side, so a teacher calling these directly gets 403
 * regardless of what the UI shows.
 */

export const listUsers = () => apiPost('/api/admin/users', { action: 'list' });

// 013Fixes / 01: no plan here — the plan is the school's, the same for every login.
export const createTeacher = ({ email, password, displayName }) =>
  apiPost('/api/admin/users', { action: 'createTeacher', email, password, displayName });

/** 013Fixes / 01: make this teacher login the school's owner (one owner). */
export const setOwner = ({ uid }) =>
  apiPost('/api/admin/users', { action: 'setOwner', uid });

/** 013Fixes / 01: the platform owner's own login, never counted against the plan. null clears it. */
export const setDevLogin = ({ devLoginEmail }) =>
  apiPost('/api/admin/users', { action: 'setDevLogin', devLoginEmail });

export const setUserRole = ({ uid, role, tier }) =>
  apiPost('/api/admin/users', { action: 'setRole', uid, role, tier });

export const setUserTier = ({ uid, tier }) =>
  apiPost('/api/admin/users', { action: 'setTier', uid, tier });

export const startTrial = ({ uid, tier, trialDays }) =>
  apiPost('/api/admin/users', { action: 'startTrial', uid, tier, trialDays });

export const setUserDisabled = ({ uid, disabled }) =>
  apiPost('/api/admin/users', { action: disabled ? 'disable' : 'enable', uid });

/** 013Fixes / 11-12: count the school's usage now (otherwise about once a day). */
export const recountUsage = () => apiPost('/api/admin/users', { action: 'recountUsage' });

/** 013Fixes / 09: extra dashboard logins on top of the plan's (added by hand). */
export const setExtraLogins = ({ extraLogins }) =>
  apiPost('/api/admin/users', { action: 'setExtraLogins', extraLogins });

/** 013Fixes / 07: plan settings (features, limits, card words). */
export const getPlanSettings = () => apiPost('/api/admin/plans', { action: 'get' });
export const savePlanSettings = (plans) => apiPost('/api/admin/plans', { action: 'save', plans });
export const resetPlanSettings = (plan) => apiPost('/api/admin/plans', { action: 'reset', plan });

/** Irreversible. `confirmEmail` must match the target exactly. */
export const deleteUser = ({ uid, confirmEmail }) =>
  apiPost('/api/admin/users', { action: 'delete', uid, confirmEmail });

/**
 * Testing affordances — force the subscription into an expiring state without
 * waiting for calendar time. Both clear the superadmin comp flag, which
 * otherwise short-circuits the whole state machine.
 */
export const expireToGrace = () =>
  apiPost('/api/admin/users', { action: 'expireToGrace' });

export const expireNow = () =>
  apiPost('/api/admin/users', { action: 'expireNow' });
