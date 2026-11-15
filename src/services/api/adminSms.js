import { apiPost } from './client';

/** The superadmin SMS card — 008Fixes / 10 (POST /api/admin/sms, superadmin only). */
const call = (body) => apiPost('/api/admin/sms', body);
export const getSmsSummary = () => call({ action: 'summary' });
export const refreshSmsBalance = () => call({ action: 'refresh' });
export const setSmsAlertRecipient = (email) => call({ action: 'setAlertRecipient', email });
export const resetSmsAlertRecipient = () => call({ action: 'resetAlertRecipient' });
