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

// 013Fixes / 22: the account card's actions (each confirmed on screen, audited).
export const changeSchoolPlan = (tier) => call({ action: 'changePlan', tier });
export const extendSchool = (days) => call({ action: 'extend', days });
export const lockSchool = () => call({ action: 'lock' });
export const unlockSchool = (until) => call({ action: 'unlock', until });
/** { notes: { contact, agreedPrice, promises, updatedAt, updatedBy } | null, history: [...] } */
export const getAccountNotes = () => call({ action: 'notes' });
export const saveAccountNotes = ({ contact, agreedPrice, promises }) => call({ action: 'saveNotes', contact, agreedPrice, promises });
/** The school's own limits and features, written whole ({ limits: {}, features: {} } clears them). */
export const saveSchoolOverrides = ({ limits, features }) => call({ action: 'saveOverrides', limits, features });

// 013Fixes / 22b: Gift (comp) and Cancel reuse /api/billing/manage. Called
// from here, not services/api/billing, so the account card's chunk does not
// split the school's own billing client out of the dashboard.
export const giftSchoolPlan = (tier) => apiPost('/api/billing/manage', { action: 'grant', tier });
export const cancelSchoolPlan = () => apiPost('/api/billing/manage', { action: 'cancel' });
