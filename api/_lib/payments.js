import { FieldValue } from './firebaseAdmin.js';
import { z } from './validate.js';
import { ApiError } from './errors.js';

/**
 * The school's payments — 013Fixes / 19-21. One document per payment at
 * `billing/payments/items/{id}` (server-only: billing/** is closed to every
 * client), written by superadmin "Start trial" (with a payment), "Record
 * payment", and the Paystack webhook (phase 21).
 *
 *   amountKes, method ('mpesa' | 'cash' | 'bank' | 'card'), code (the M-Pesa
 *   code, upper case; null otherwise), note, tier, periodFrom, periodTo,
 *   kind ('trial_payment' | 'payment'), source ('manual' | 'paystack'),
 *   actor, createdAt
 *
 * An M-Pesa code is recorded once: its document id is `mpesa_<CODE>`, created
 * in the caller's transaction, so the same code twice is refused (owner: "the
 * same code twice is refused"). Codes never go to the logs.
 */

export const PAYMENT_METHODS = Object.freeze(['mpesa', 'cash', 'bank']);
const MPESA_CODE = /^[A-Z0-9]{10}$/;

export const paymentSchema = z.object({
  amountKes: z.number().int().min(1).max(10_000_000),
  method: z.enum(PAYMENT_METHODS),
  code: z.string().trim().max(20).optional(),
  note: z.string().trim().max(300).optional(),
}).strict();

const itemsPath = 'billing/payments/items';

/** The payment as entered, checked: an M-Pesa code is required and well formed. */
export function checkPayment(payment) {
  if (!payment) return null;
  const code = payment.code ? payment.code.trim().toUpperCase() : null;
  if (payment.method === 'mpesa' && !code) {
    throw new ApiError(400, 'code_required', 'Enter the M-Pesa code (10 letters and numbers).');
  }
  if (code && !MPESA_CODE.test(code)) {
    throw new ApiError(400, 'bad_code', 'An M-Pesa code is 10 letters and numbers, for example QAB1C2D3E4.');
  }
  return { ...payment, code };
}

/** The document a payment is written to: its M-Pesa code, or a fresh id. */
export function paymentRef(db, payment) {
  const items = db.collection(itemsPath);
  return payment.code ? items.doc(`mpesa_${payment.code}`) : items.doc();
}

/**
 * Inside the caller's transaction: refuses an M-Pesa code already recorded
 * (read first, before the caller's writes), then returns a writer to call
 * after the caller's own reads.
 */
export async function preparePaymentInTx(tx, db, payment) {
  const ref = paymentRef(db, payment);
  if (payment.code) {
    const existing = await tx.get(ref);
    if (existing.exists) throw new ApiError(409, 'payment_code_used', 'That M-Pesa code is already recorded.');
  }
  return (record) => tx.create(ref, {
    amountKes: payment.amountKes,
    method: payment.method,
    code: payment.code ?? null,
    note: payment.note ?? null,
    createdAt: FieldValue.serverTimestamp(),
    ...record,
  });
}
