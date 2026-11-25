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

// ---------------------------------------------------------------- 013Fixes / 21

/** Paystack's channel as a payment method. */
export function paystackMethod(channel) {
  if (channel === 'mobile_money') return 'mpesa';
  if (channel === 'card') return 'card';
  if (channel === 'bank' || channel === 'bank_transfer') return 'bank';
  return channel || 'paystack';
}

/** The document an in-app payment is written to: one per Paystack reference. */
export function paystackPaymentRef(db, reference) {
  return db.collection(itemsPath).doc(`paystack_${reference}`);
}

/** An in-app payment's record (the webhook, and the backfill). */
export function paystackPaymentRecord({ reference, amountKes, channel, tier, periodFrom, periodTo, paidAt }) {
  return {
    amountKes,
    method: paystackMethod(channel),
    code: null,
    note: null,
    tier: tier ?? null,
    periodFrom: periodFrom ?? null,
    periodTo: periodTo ?? null,
    kind: 'payment',
    source: 'paystack',
    reference,
    actor: 'system:paystack',
    createdAt: paidAt ?? FieldValue.serverTimestamp(),
  };
}

export const PAYMENTS_PAGE = 20;

const millis = (t) => (t == null ? null : t.toMillis?.() ?? (t instanceof Date ? t.getTime() : null));

/**
 * One page of payments, newest first. `cursor` is the last item's createdAt
 * (millis) from the previous page. The school's view (`forSchool`) leaves out
 * the M-Pesa code, the note and who recorded it: the owner's own business.
 */
export async function listPayments(db, { cursor = null, forSchool = false } = {}) {
  let query = db.collection(itemsPath).orderBy('createdAt', 'desc').limit(PAYMENTS_PAGE);
  if (cursor != null) query = query.startAfter(new Date(cursor));
  const snap = await query.get();
  const items = snap.docs.map((d) => {
    const p = d.data();
    const base = {
      id: d.id,
      createdAt: millis(p.createdAt),
      amountKes: p.amountKes ?? null,
      method: p.method ?? null,
      tier: p.tier ?? null,
      periodFrom: millis(p.periodFrom),
      periodTo: millis(p.periodTo),
    };
    if (forSchool) return base;
    return {
      ...base,
      code: p.code ?? null,
      note: p.note ?? null,
      kind: p.kind ?? null,
      source: p.source ?? null,
      reference: p.reference ?? null,
      backfilled: p.backfilled === true,
    };
  });
  return { items, nextCursor: items.length === PAYMENTS_PAGE ? items[items.length - 1].createdAt : null };
}
