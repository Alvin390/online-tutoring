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

/**
 * 013Fixes / 20: a payment made to the owner directly. One calendar month:
 * locked → from now; early → from the current end. `preview: true` returns
 * the window ({ from, to, startsNow }) and writes nothing.
 */
export const recordSchoolPayment = ({ tier, amountKes, method, code, note, preview }) =>
  call({
    action: 'recordPayment', tier, amountKes, method,
    ...(code ? { code } : {}), ...(note ? { note } : {}), ...(preview ? { preview: true } : {}),
  });

/** 013Fixes / 21: every payment, newest first, 20 a page ({ items, nextCursor }). */
export const listAllPayments = (cursor) => call({ action: 'payments', ...(cursor ? { cursor } : {}) });

/** 013Fixes / 21: older in-app payments into the history. A dry run unless `apply`. */
export const backfillPayments = (apply = false) => call({ action: 'backfillPayments', ...(apply ? { apply: true } : {}) });
