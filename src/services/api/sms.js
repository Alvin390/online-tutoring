import { apiPost } from './client';

/**
 * SMS through HashBack — 008Fixes / 07–10 (POST /api/messages/sms).
 * Imported only by the lazy Messages pieces. Refusals arrive as ApiError with
 * a `code` (sms_off, sms_locked, too_long, unsupported_characters,
 * low_credit, tier_required, …) and the server's own words.
 */

const call = (body, options) => apiPost('/api/messages/sms', body, options);

// Setup (Phase 08)
export const getSmsSetup = () => call({ action: 'setup' });
export const saveSchoolName = (schoolName) => call({ action: 'saveSchoolName', schoolName });
export const sendSmsTest = (phone) => call({ action: 'sendTest', phone });
export const unlockSms = () => call({ action: 'unlock' });

// Messages (Phase 07, used from Phase 09)
export const previewSms = (template, filter) => call({ action: 'preview', template, filter });
export const startSms = (template, filter, title) => call({ action: 'start', template, filter, ...(title ? { title } : {}) });
export const sendSmsChunk = (campaignId) => call({ action: 'sendChunk', campaignId }, { retry: 1 });
export const cancelSms = (campaignId) => call({ action: 'cancel', campaignId });
export const sendSmsToOne = (session, phone, template) => call({ action: 'sendOne', session, phone, template });
export const listSms = () => call({ action: 'list' });
export const getSms = (campaignId) => call({ action: 'get', campaignId });
export const refreshSms = (campaignId) => call({ action: 'refresh', campaignId });
