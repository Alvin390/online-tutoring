import { apiGet, apiPost } from './client';

/**
 * Bug reports and feature requests — Phase 13 / 06.
 *
 * Teacher calls (submit, attachment, mine) and the superadmin's inbox and
 * notification settings. Every rule — ownership, rate limits, the status
 * workflows — is enforced server-side; these are thin wrappers.
 */

// ------------------------------------------------------------------ teacher

/** One compressed image (full or thumbnail) for a report being written. */
export const uploadReportAttachment = ({ reportId, index, variant, contentType, data, width, height }, { signal } = {}) =>
  apiPost('/api/reports/attachment', { reportId, index, variant, contentType, data, width, height }, { signal, timeoutMs: 30_000 });

export const submitReport = (report) => apiPost('/api/reports/submit', report);

export const listMyReports = () => apiGet('/api/reports/mine');

// --------------------------------------------------------------- superadmin

export const listReports = ({ type, status, cursor } = {}) =>
  apiPost('/api/admin/reports', { action: 'list', type, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });

export const getReport = (id) => apiPost('/api/admin/reports', { action: 'get', id });

export const setReportStatus = ({ id, status }) => apiPost('/api/admin/reports', { action: 'setStatus', id, status });

export const addReportNote = ({ id, text }) => apiPost('/api/admin/reports', { action: 'addNote', id, text });

export const resendReportEmail = (id) => apiPost('/api/admin/reports', { action: 'resendEmail', id });

export const deleteReport = (id) => apiPost('/api/admin/reports', { action: 'delete', id });

export const getNotificationSettings = () => apiPost('/api/admin/notifications', { action: 'get' });

export const setReportRecipient = (email) => apiPost('/api/admin/notifications', { action: 'setRecipient', email });

export const sendTestEmail = () => apiPost('/api/admin/notifications', { action: 'sendTest' }, { timeoutMs: 30_000 });
