import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { listPayments } from '../_lib/payments.js';

/**
 * The school's payments — 013Fixes / 21 (owner suggestion 5). Newest first,
 * 20 a page: date, amount, method, package and the period each one covered.
 * Never the M-Pesa code, the note or who recorded it (the superadmin's list
 * has those). All staff see the school's billing (owner, 2026-10-31).
 */

const schema = z.object({ cursor: z.number().int().positive().optional() }).strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'billing_payments', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body }) => listPayments(getDb(), { cursor: body.cursor ?? null, forSchool: true }),
});
