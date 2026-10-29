import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { declineDuplicate, mergeDuplicate, keepBoth, allowNumber } from '../_lib/duplicateActions.js';

/**
 * POST /api/students/duplicates — 003Fixes / 12. Teacher only.
 *
 *   { action: 'decline', session, phone }              remove it, retire the number
 *   { action: 'merge', session, keep, remove, cursor? } notes and money to `keep`
 *   { action: 'keepBoth', session, a, b }               never flagged again
 *   { action: 'allowNumber', session, phone }           lift a retired number
 *
 * Audited with counts only; no reply carries a student's name.
 */

const cursor = z.string().trim().min(1).max(200);

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decline'), session: sessionSchema, phone: phoneSchema }).strict(),
  z.object({ action: z.literal('merge'), session: sessionSchema, keep: phoneSchema, remove: phoneSchema, cursor: cursor.optional() }).strict(),
  z.object({ action: z.literal('keepBoth'), session: sessionSchema, a: phoneSchema, b: phoneSchema }).strict(),
  z.object({ action: z.literal('allowNumber'), session: sessionSchema, phone: phoneSchema }).strict(),
]);

export default createHandler({
  // Every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'students_duplicates', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const { session } = body;
    const audit = (action, target, after) => tryWriteAudit({
      action, actor: user.uid, actorRole: user.role, target, after, context: { requestId: log.requestId },
    }, log);

    switch (body.action) {
      case 'decline': {
        const result = await declineDuplicate({ db, session, phone: body.phone, user });
        log.info('Duplicate declined', { session, notesRemoved: result.notesRemoved });
        await audit('students.duplicate_declined', `${session}/${body.phone}`, result);
        return { ok: true, ...result };
      }
      case 'merge': {
        const result = await mergeDuplicate({ db, session, keep: body.keep, remove: body.remove, cursor: body.cursor ?? null, user });
        if (result.done && !result.alreadyMerged) {
          log.info('Duplicate merged', { session, notesMoved: result.notesMoved, moved: result.balanceMoved !== 0 });
          await audit('students.duplicate_merged', `${session}/${body.remove}`, { keptSuffix: body.keep.slice(-3), notesMoved: result.notesMoved, balanceMoved: result.balanceMoved });
        }
        return { ok: true, ...result };
      }
      case 'keepBoth': {
        const result = await keepBoth({ db, session, a: body.a, b: body.b });
        await audit('students.duplicate_kept', `${session}/${body.a}`, { kept: 2 });
        return { ok: true, ...result };
      }
      default: {
        const result = await allowNumber({ db, session, phone: body.phone });
        await audit('students.number_allowed', `${session}/${body.phone}`, result);
        return { ok: true, ...result };
      }
    }
  },
});
