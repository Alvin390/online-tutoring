import { apiPost } from './client';

/** Superadmin → M-Pesa payments (STK) — 013Fixes / 29-30 (POST /api/admin/daraja). */
const call = (body) => apiPost('/api/admin/daraja', body);

/** { keys: { saved, shortCodeType, last4, savedAt }, sources: { sandbox, live }, mpesa: { mode, liveTested, testPending, … }, ready } */
export const getMpesaSetup = () => call({ action: 'status' });
/** Write-only: the reply carries the last 4 characters, never a value. */
export const saveMpesaKeys = ({ consumerKey, consumerSecret, passkey, shortCode, shortCodeType }) =>
  call({ action: 'save', consumerKey, consumerSecret, passkey, shortCode, shortCodeType });
export const clearMpesaKeys = () => call({ action: 'clear' });
/** 013Fixes / 30b: 'off' | 'demo' | 'live'. */
export const setMpesaMode = (mode) => call({ action: 'setMode', mode });
/** KES 1 to the phone typed. */
export const sendMpesaTest = (phone) => call({ action: 'testPush', phone });
export const checkMpesaTest = () => call({ action: 'testResult' });
