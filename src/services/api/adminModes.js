import { apiPost } from './client';

/** Superadmin → Settings → Modes — 013Fixes / 33-35 (POST /api/admin/modes). */
const call = (body) => apiPost('/api/admin/modes', body);

/** { payments: { mode, source, liveKeys }, sms: { mode, source }, paidPeriod } */
export const getModes = () => call({ action: 'status' });
/** 'live' | 'test'; `confirm: 'TEST'` when the school is in a paid period. */
export const setPaymentsMode = (mode, confirm) => call({ action: 'setPayments', mode, ...(confirm ? { confirm } : {}) });
/** 013Fixes / 33b: 'real' | 'fake'. */
export const setSmsMode = (mode) => call({ action: 'setSms', mode });
