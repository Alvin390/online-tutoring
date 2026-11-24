import { apiPost } from './client';

/** The superadmin SMS card — 008Fixes / 10 (POST /api/admin/sms, superadmin only). */
const call = (body) => apiPost('/api/admin/sms', body);
export const getSmsSummary = () => call({ action: 'summary' });
export const refreshSmsBalance = () => call({ action: 'refresh' });
export const setSmsAlertRecipient = (email) => call({ action: 'setAlertRecipient', email });
export const resetSmsAlertRecipient = () => call({ action: 'resetAlertRecipient' });

/** 013Fixes / 14-16: the school's SMS units (included this window, extra) and the ledger. */
export const getSmsCredits = () => call({ action: 'credits' });
/** Adds extra units by hand; `key` makes a double click add once. */
export const addSmsUnits = ({ units, note, key }) => call({ action: 'addUnits', units, key, ...(note ? { note } : {}) });
