import { apiPost } from './client';

/**
 * The teacher's side of admission numbers — 008Fixes / 05
 * (POST /api/students/admission). Imported only by lazy dashboard pieces.
 */

const call = (body) => apiPost('/api/students/admission', body);

/** Give a registration a number, or change it. Refusals: number_taken, easy_number. */
export const setAdmissionNumber = (session, phone, number) => call({ action: 'set', session, phone, number });

/** "Allow again": this class's one-device lock is lifted. */
export const allowCheckinAgain = (session, phone) => call({ action: 'allowAgain', session, phone });

/** The one-time codes still waiting: [{ session, phone, phoneEnding, name, code, expiresAtMs }]. */
export const listWaitingCodes = () => call({ action: 'codes' });
