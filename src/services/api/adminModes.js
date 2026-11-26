import { apiPost } from './client';

/** Superadmin → Settings → Modes — 013Fixes / 33-35 (POST /api/admin/modes). */
const call = (body) => apiPost('/api/admin/modes', body);

/** { payments: { mode, source, liveKeys }, sms: { mode, source }, paidPeriod } */
export const getModes = () => call({ action: 'status' });
/** 'live' | 'test'; `confirm: 'TEST'` when the school is in a paid period. */
export const setPaymentsMode = (mode, confirm) => call({ action: 'setPayments', mode, ...(confirm ? { confirm } : {}) });
/** 013Fixes / 33b: 'real' | 'fake'. */
export const setSmsMode = (mode) => call({ action: 'setSms', mode });
/** 013Fixes / 35: the demo preset; `confirm: 'TEST'` in a paid period on live payments. */
export const setDemo = (on, confirm) => call({ action: 'setDemo', on, ...(confirm ? { confirm } : {}) });
/** 013Fixes / 34: on/off, with an optional message and end time (ms). */
export const setMaintenance = ({ on, message, until }) => call({ action: 'setMaintenance', on, ...(on && message ? { message } : {}), ...(on && until ? { until } : {}) });
