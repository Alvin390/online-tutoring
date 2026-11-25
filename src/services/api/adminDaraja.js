import { apiPost } from './client';

/** Superadmin → M-Pesa payments (STK) — 013Fixes / 29-30 (POST /api/admin/daraja). */
const call = (body) => apiPost('/api/admin/daraja', body);

/** { mode, source, keys: { saved, shortCodeType, last4, savedAt }, mpesa: { enabled, online, testPending, … }, ready } */
export const getMpesaSetup = () => call({ action: 'status' });
/** Write-only: the reply carries the last 4 characters, never a value. */
export const saveMpesaKeys = ({ consumerKey, consumerSecret, passkey, shortCode, shortCodeType }) =>
  call({ action: 'save', consumerKey, consumerSecret, passkey, shortCode, shortCodeType });
export const clearMpesaKeys = () => call({ action: 'clear' });
export const setMpesaEnabled = (enabled) => call({ action: 'setEnabled', enabled });
/** KES 1 to the phone typed. */
export const sendMpesaTest = (phone) => call({ action: 'testPush', phone });
export const checkMpesaTest = () => call({ action: 'testResult' });
