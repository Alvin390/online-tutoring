import { apiPost } from './client';

/**
 * The school's dashboard logins — 013Fixes / 10. The owner (and the
 * superadmin) only; the server enforces it and the seat limit.
 */
const call = (body) => apiPost('/api/school/logins', body);

export const listLogins = () => call({ action: 'list' });
export const addLogin = ({ email, password, displayName }) =>
  call({ action: 'add', email, password, ...(displayName ? { displayName } : {}) });
export const disableLogin = (uid) => call({ action: 'disable', uid });
export const enableLogin = (uid) => call({ action: 'enable', uid });
export const removeLogin = (uid, confirmEmail) => call({ action: 'remove', uid, confirmEmail });
