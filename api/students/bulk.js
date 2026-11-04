import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { requireTier } from '../_lib/auth.js';
import { badRequest, forbidden } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { assertSessionExists } from '../_lib/sessions.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { withDevice } from '../_lib/device.js';
import {
  MAX_ITEMS, openBatch, applyStudents, undoBatch, listRecent, assertChunkSize, listBatchItems, deleteStudents,
} from '../_lib/bulkStudents.js';

/**
 * Block, unblock, approve receipts and undo — for many students at once.
 * 003Fixes / 04 (block, unblock, undo, list) and 06 (approveReceipts).
 *
 * The single-student block and unblock stay as they were; this is the path
 * for selections. See api/_lib/bulkStudents.js for the batch model.
 */

const item = z.object({ session: sessionSchema, phone: phoneSchema }).strict();
const items = z.array(item).min(1).max(MAX_ITEMS.block);
// 006Fixes / 05: a partial approval carries each student's own amount.
const approveItem = z.object({
  session: sessionSchema, phone: phoneSchema, amount: z.number().int().min(1).max(10_000_000).optional(),
}).strict();
const batchId = z.string().trim().regex(/^[A-Za-z0-9]{1,40}$/);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('block'),
    items,
    kind: z.enum(['fees', 'other']),
    amount: z.number().int().min(1).max(10_000_000).optional(),
    // 006Fixes / 09 (owner): false = "block for what they owe", no new charge.
    charge: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
    batchId: batchId.optional(),
  }).strict(),
  z.object({ action: z.literal('unblock'), items, batchId: batchId.optional() }).strict(),
  z.object({
    action: z.literal('approveReceipts'),
    items: z.array(approveItem).min(1).max(MAX_ITEMS.approveReceipts),
    payment: z.enum(['full', 'partial']).optional(),
    batchId: batchId.optional(),
  }).strict(),
  // 006Fixes / 01 (owner): the teacher types DELETE; the server checks it too.
  z.object({
    action: z.literal('delete'),
    items: z.array(item).min(1).max(MAX_ITEMS.delete),
    confirm: z.literal('DELETE'),
    batchId: batchId.optional(),
  }).strict(),
  z.object({ action: z.literal('undo'), batchId }).strict(),
  z.object({ action: z.literal('list') }).strict(),
  // 003Fixes / 09: who an action reached, for "Message these parents".
  z.object({ action: z.literal('items'), batchId }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'students_bulk', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user: signedIn, log }) => {
    const db = getDb();
    const nowMs = Date.now();
    // 004Fixes / 05: the staff member plus a coarse device note, kept on the
    // records and in the audit (Cloudflare's request logs last 3 days).
    const user = withDevice(signedIn, req);

    if (body.action === 'items') {
      return { items: await listBatchItems({ db, user, batchId: body.batchId }) };
    }

    if (body.action === 'list') {
      return { actions: await listRecent({ db, user, nowMs }), limits: MAX_ITEMS };
    }

    if (body.action === 'undo') {
      const result = await undoBatch({ db, user, batchId: body.batchId, nowMs });
      log.info('Bulk action undone', { status: result.status, undone: result.undone, changedSince: result.changedSince });
      if (!result.remaining) {
        await tryWriteAudit({
          action: 'students.bulk_undone',
          actor: user.uid,
          actorRole: user.role,
          target: `bulkActions/${body.batchId}`,
          context: { requestId: log.requestId, device: user.device },
        }, log);
      }
      return { ok: true, ...result };
    }

    if (body.action === 'delete') {
      assertChunkSize(body.items, MAX_ITEMS.delete);
      for (const slug of new Set(body.items.map((i) => i.session))) await assertSessionExists(db, slug);
      const batch = await openBatch({ db, user, batchId: body.batchId, action: 'delete', nowMs });
      const result = await deleteStudents({
        db, user, batch, items: body.items, nowMs, context: { requestId: log.requestId, device: user.device },
      });
      log.info('Bulk delete applied', {
        done: result.done, skipped: result.skipped, failed: result.failed.length, balanceClosedCount: result.balanceClosedCount,
      });
      if (batch.isNew) {
        await tryWriteAudit({
          action: 'students.bulk_delete',
          actor: user.uid,
          actorRole: user.role,
          target: `bulkActions/${batch.id}`,
          context: { requestId: log.requestId, device: user.device },
        }, log);
      }
      return { ok: true, ...result, limits: MAX_ITEMS };
    }

    const isFees = body.action === 'block' && body.kind === 'fees';
    // 006Fixes / 09: a fee block charges unless the teacher chose "for what they owe".
    const charge = isFees && body.charge !== false;
    if (isFees) {
      // The same gates as /api/fees/post: Silver, and fees switched on.
      requireTier(user, 'silver');
      if (!(await isEnabled('fees.enabled'))) throw forbidden('Fees are not enabled.', 'feature_disabled');
      if (charge && !body.amount) throw badRequest('Enter the amount owed.', 'amount_required');
    }
    assertChunkSize(body.items, isFees ? MAX_ITEMS.blockFees : MAX_ITEMS[body.action]);

    // Every session named must exist (cached per isolate for 60 s).
    for (const slug of new Set(body.items.map((i) => i.session))) await assertSessionExists(db, slug);

    // Approving receipts records the balance as paid only with fees switched on.
    const feesEnabled = body.action === 'approveReceipts' ? await isEnabled('fees.enabled') : false;

    const batch = await openBatch({
      db,
      user,
      batchId: body.batchId,
      action: body.action,
      kind: body.action === 'block' ? body.kind : null,
      amount: charge ? body.amount : null,
      reason: body.action === 'block' && !isFees ? (body.reason ?? '') : null,
      nowMs,
      payment: body.action === 'approveReceipts' ? (body.payment ?? 'full') : null,
      charge: isFees ? charge : null,
    });

    const result = await applyStudents({
      db,
      user,
      batch,
      action: body.action,
      items: body.items,
      kind: body.action === 'block' ? body.kind : null,
      amount: charge ? body.amount : null,
      charge,
      reason: body.action === 'block' ? (body.reason ?? '') : null,
      nowMs,
      recordedBy: user.uid,
      feesEnabled,
      payment: body.payment ?? 'full',
    });

    log.info('Bulk action applied', {
      action: body.action, kind: body.kind ?? null, done: result.done, skipped: result.skipped, failed: result.failed.length,
    });
    if (batch.isNew) {
      await tryWriteAudit({
        action: `students.bulk_${body.action}`,
        actor: user.uid,
        actorRole: user.role,
        target: `bulkActions/${batch.id}`,
        after: { kind: body.kind ?? null, amount: charge ? body.amount : null, ...(isFees ? { charge } : {}) },
        context: { requestId: log.requestId, device: user.device },
      }, log);
    }

    const { outcomes, ...summary } = result; // eslint-disable-line no-unused-vars
    return { ok: true, ...summary, limits: MAX_ITEMS };
  },
});
