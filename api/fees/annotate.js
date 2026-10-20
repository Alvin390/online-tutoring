import { createHandler } from '../_lib/handler.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { ApiError, forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { fillMissingReference } from '../_lib/ledger.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Add a missing receipt code to a ledger entry — Phase 13 / 04 D3.
 *
 * For the rare M-Pesa payment recovered by the reconcile cron: Daraja's status
 * query confirms the money moved but returns NO receipt code, so the entry is
 * posted with `reference: null, receiptPending: true`. The teacher can see the
 * code in their M-Pesa statement and fill it in here.
 *
 * Fills `reference` ONLY while it is null (409 otherwise) and touches nothing
 * else — amount, type and dates are untouchable, so the ledger stays
 * append-only for every money field. Server-side because the rules keep the
 * ledger write-closed to every client.
 *
 * `reference` must look like an M-Pesa receipt (10 letters/digits) unless
 * `notMpesa` is set, for a payment that was really cash or bank.
 */

const MPESA_RECEIPT = /^[A-Z0-9]{10}$/;

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    entryId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    reference: z.string().trim().min(1).max(40),
    notMpesa: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.notMpesa && !MPESA_RECEIPT.test(body.reference.toUpperCase())) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'An M-Pesa receipt is 10 letters and digits, e.g. TJK9XYZ8QP. Tick "not an M-Pesa receipt" for cash or bank.',
      });
    }
    if (body.notMpesa && !/^[\p{L}\p{N} .,:/#'-]+$/u.test(body.reference)) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Use letters, numbers and simple punctuation.' });
    }
  });

export default createHandler({
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'fees_annotate', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    if (!(await isEnabled('fees.enabled'))) {
      throw forbidden('Fees are not enabled.', 'feature_disabled');
    }

    const reference = body.notMpesa ? body.reference : body.reference.toUpperCase();
    const result = await fillMissingReference({
      phone: body.phone,
      entryId: body.entryId,
      reference,
      addedBy: user.uid,
      notMpesa: body.notMpesa === true,
    });

    if (!result.filled && result.reason === 'missing') throw notFound('That ledger entry does not exist.');
    if (!result.filled) {
      throw new ApiError(409, 'reference_already_set', 'This entry already has a reference. It cannot be changed.');
    }

    log.info('Ledger reference added', { session: body.session, notMpesa: body.notMpesa === true });

    await tryWriteAudit(
      {
        action: 'fees.reference_added',
        actor: user.uid,
        actorRole: user.role,
        target: `fees/accounts/items/${body.phone}/ledger/${body.entryId}`,
        after: { reference, notMpesa: body.notMpesa === true },
        context: { requestId: log.requestId },
      },
      log
    );

    return { ok: true, entryId: body.entryId, reference };
  },
});
