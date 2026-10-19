import { apiPost } from './client';

/**
 * M-Pesa payment calls — Phase 09.
 *
 * `payAmount` is OPTIONAL and, when given, is validated server-side against the
 * real ledger balance. The full amount is never trusted from the client: a
 * caller that could name its own figure could pay KES 1 against a KES 3,000
 * balance and have the block lift.
 */

export const initiatePayment = ({ session, phone, payerPhone, payAmount }) =>
  apiPost('/api/payments/initiate', {
    session,
    phone,
    ...(payerPhone ? { payerPhone } : {}),
    ...(payAmount ? { payAmount } : {}),
  });

export const getPaymentStatus = (checkoutRequestId, phone) =>
  apiPost('/api/payments/status', { checkoutRequestId, phone });

// M-Pesa credentials are operator-supplied environment variables (Phase 13):
// there is no teacher-facing credentials call any more.
