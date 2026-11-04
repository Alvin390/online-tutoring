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
  MAX_CREATE_ITEMS, createSchedule, listSchedules, rescheduleSchedule, cancelSchedule, removeMember, removeMembers,
} from '../_lib/scheduledBlocks.js';

/**
 * Scheduled blocks — 003Fixes / 07. Create (a selection or one student), list
 * what is waiting, reschedule or cancel a whole schedule, or take one student
 * out. Applying them is the per-minute sweep (api/cron/scheduledBlocksSweep.js).
 */

const item = z.object({ session: sessionSchema, phone: phoneSchema }).strict();
const id = z.string().trim().regex(/^[A-Za-z0-9]{1,40}$/);
const atMs = z.number().int().positive();

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    items: z.array(item).min(1).max(MAX_CREATE_ITEMS),
    atMs,
    kind: z.enum(['fees', 'other']),
    amount: z.number().int().min(1).max(10_000_000).optional(),
    // 006Fixes / 09: false = "block for what they owe", no new charge.
    charge: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
    batchId: id.optional(),
  }).strict(),
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('reschedule'), batchId: id, atMs }).strict(),
  z.object({ action: z.literal('cancel'), batchId: id }).strict(),
  z.object({ action: z.literal('removeMember'), batchId: id, session: sessionSchema, phone: phoneSchema }).strict(),
  // 003Fixes / 08: "Cancel schedule" on a selection, whatever schedule each is in.
  z.object({ action: z.literal('removeMembers'), items: z.array(item).min(1).max(MAX_CREATE_ITEMS) }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'students_scheduled', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user: signedIn, log }) => {
    const db = getDb();
    const nowMs = Date.now();
    // 004Fixes / 05: the staff member plus a coarse device note (see bulk.js).
    const user = withDevice(signedIn, req);

    switch (body.action) {
      case 'list':
        return { schedules: await listSchedules({ db }) };
      case 'reschedule': {
        // 004Fixes / 02: any staff account may move any schedule, so record who.
        const result = await rescheduleSchedule({ db, user, batchId: body.batchId, atMs: body.atMs, nowMs });
        await tryWriteAudit({ action: 'students.schedule_rescheduled', actor: user.uid, actorRole: user.role, target: `scheduledBlocks/${body.batchId}`, after: { atMs: body.atMs }, context: { requestId: log.requestId, device: user.device } }, log);
        return { ok: true, ...result };
      }
      case 'cancel': {
        const result = await cancelSchedule({ db, user, batchId: body.batchId });
        await tryWriteAudit({ action: 'students.schedule_cancelled', actor: user.uid, actorRole: user.role, target: `scheduledBlocks/${body.batchId}`, context: { requestId: log.requestId, device: user.device } }, log);
        return { ok: true, ...result };
      }
      case 'removeMembers': {
        const result = await removeMembers({ db, user, items: body.items });
        if (result.removed) {
          await tryWriteAudit({ action: 'students.schedule_members_removed', actor: user.uid, actorRole: user.role, target: 'scheduledBlocks', after: { removed: result.removed }, context: { requestId: log.requestId, device: user.device } }, log);
        }
        return { ok: true, ...result };
      }
      case 'removeMember': {
        await assertSessionExists(db, body.session);
        const result = await removeMember({ db, user, batchId: body.batchId, session: body.session, phone: body.phone });
        await tryWriteAudit({ action: 'students.schedule_members_removed', actor: user.uid, actorRole: user.role, target: `scheduledBlocks/${body.batchId}`, after: { removed: 1 }, context: { requestId: log.requestId, device: user.device } }, log);
        return { ok: true, ...result };
      }
      default: {
        if (body.kind === 'fees') {
          requireTier(user, 'silver');
          if (!(await isEnabled('fees.enabled'))) throw forbidden('Fees are not enabled.', 'feature_disabled');
          if (body.charge !== false && !body.amount) throw badRequest('Enter the amount owed.', 'amount_required');
        }
        for (const slug of new Set(body.items.map((i) => i.session))) await assertSessionExists(db, slug);
        const result = await createSchedule({
          db, user, batchId: body.batchId, items: body.items, atMs: body.atMs, kind: body.kind,
          amount: body.charge === false ? null : (body.amount ?? null), reason: body.reason ?? null, nowMs,
          charge: body.kind === 'fees' ? body.charge !== false : null,
        });
        log.info('Block scheduled', { added: result.added, kind: body.kind });
        if (!body.batchId) {
          await tryWriteAudit({ action: 'students.block_scheduled', actor: user.uid, actorRole: user.role, target: `scheduledBlocks/${result.batchId}`, after: { atMs: result.atMs, kind: body.kind }, context: { requestId: log.requestId, device: user.device } }, log);
        }
        return { ok: true, ...result };
      }
    }
  },
});
