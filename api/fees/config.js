import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Fee configuration — Phase 06 D1.
 *
 * Silver tier and above. `requireTier` is applied by the middleware chain, so a
 * Bronze token calling this gets a 403 from the handler rather than from the UI
 * — the UI hiding a button is not a control.
 */

const schema = z
  .object({
    // GET carries no body; POST carries all of these.
    billingDayOfMonth: z.number().int().min(1).max(28).optional(),
    defaultFeeByClass: z.record(z.string().max(60), z.number().int().min(0).max(10_000_000)).optional(),
    gracePeriodDays: z.number().int().min(0).max(90).optional(),
    autoBlockOnOverdue: z.boolean().optional(),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{1,8}$/).optional(),
  })
  .strict();

export const DEFAULT_FEE_CONFIG = {
  currency: 'KES',
  // Capped at 28 so no month is skipped. Billing on the 30th means February
  // never bills, and billing on the 31st means seven months a year do not.
  billingDayOfMonth: 1,
  defaultFeeByClass: {},
  gracePeriodDays: 7,
  // Default FALSE, per Q52. Automatically locking students out of class over a
  // date calculation, with no teacher review, is not a default anyone should
  // inherit.
  autoBlockOnOverdue: false,
  invoicePrefix: 'INV',
};

export default createHandler({
  method: ['GET', 'POST'],
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'fees_config', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user, log }) => {
    const db = getDb();
    const ref = db.doc('fees/config');

    if (req.method === 'GET') {
      const snap = await ref.get();
      return { config: { ...DEFAULT_FEE_CONFIG, ...(snap.exists ? snap.data() : {}) } };
    }

    const before = (await ref.get()).data() ?? null;

    const patch = { currency: 'KES', updatedAt: FieldValue.serverTimestamp() };
    for (const key of [
      'billingDayOfMonth',
      'defaultFeeByClass',
      'gracePeriodDays',
      'autoBlockOnOverdue',
      'invoicePrefix',
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    await ref.set(patch, { merge: true });

    log.info('Fee config updated', {
      autoBlockOnOverdue: patch.autoBlockOnOverdue,
      billingDayOfMonth: patch.billingDayOfMonth,
    });

    await tryWriteAudit(
      {
        action: 'fees.config_updated',
        actor: user.uid,
        actorRole: user.role,
        target: 'fees/config',
        before: before ? { autoBlockOnOverdue: before.autoBlockOnOverdue } : null,
        after: { autoBlockOnOverdue: patch.autoBlockOnOverdue },
        context: { requestId: log.requestId },
      },
      log
    );

    const after = await ref.get();
    return { ok: true, config: { ...DEFAULT_FEE_CONFIG, ...after.data() } };
  },
});
