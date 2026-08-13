import { apiGet, apiPost } from './client';

/**
 * Fee ledger calls — Phase 06.
 *
 * Every posting goes through the server. There is no client-side Firestore
 * write anywhere in the money path: the balance is computed inside the same
 * transaction that appends the entry, and a client write could produce a
 * balance that disagrees with the entries that supposedly created it.
 */

export const getFeeConfig = () => apiGet('/api/fees/config');

export const saveFeeConfig = (config) => apiPost('/api/fees/config', config);

/** Record a payment, invoice or adjustment. Amounts are whole KES integers. */
export const postLedgerEntry = (payload) => apiPost('/api/fees/post', payload);

export const recordPayment = ({ session, phone, amount, method, reference, note, occurredAt }) =>
  postLedgerEntry({ session, phone, type: 'payment', amount, method, reference, note, occurredAt });

/** Corrects a mistake by posting an opposing entry — never by editing one. */
export const reverseLedgerEntry = ({ session, phone, entryId, note }) =>
  postLedgerEntry({ session, phone, type: 'reversal', reversesEntryId: entryId, note });

export const getFeeSummary = (session, phone) =>
  apiPost('/api/fees/summary', { session, phone });

export const approveReceiptWithPayment = (payload) =>
  apiPost('/api/fees/approveReceipt', payload);

export const generateInvoices = (payload = {}) =>
  apiPost('/api/fees/generateInvoices', payload);
