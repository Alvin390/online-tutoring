import { apiPost } from './client';

/** Superadmin billing — 013Fixes / 18 onwards (POST /api/admin/billing, superadmin only). */
const call = (body) => apiPost('/api/admin/billing', body);

/** { settings: { trialDays, countdownHours, cardRenewalToleranceHours } } */
export const getBillingSettings = () => call({ action: 'settings' });
export const saveBillingSettings = (settings) => call({ action: 'saveSettings', settings });

/**
 * 013Fixes / 19: the school into a trial. `payment` (optional) is
 * { amountKes, method: 'mpesa' | 'cash' | 'bank', code?, note? }.
 */
export const startSchoolTrial = ({ tier, days, payment }) =>
  call({ action: 'startTrial', tier, ...(days ? { days } : {}), ...(payment ? { payment } : {}) });
