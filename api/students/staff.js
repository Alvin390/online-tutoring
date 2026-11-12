import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { assertSessionExists } from '../_lib/sessions.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { withDevice } from '../_lib/device.js';
import { MAX_STAFF_ITEMS, markStaff, unmarkStaff } from '../_lib/staff.js';

/**
 * Mark registrations as staff, or set them back to students — 007Fixes / 07.
 * The marker is server-owned (firestore.rules): this is the only way in.
 * See api/_lib/staff.js for what marking does.
 */

const items = z.array(z.object({ session: sessionSchema, phone: phoneSchema }).strict()).min(1).max(MAX_STAFF_ITEMS);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('mark'),
    items,
    alsoOtherSession: z.boolean().optional(),
    // One id per teacher action, reused on a retry: the balance closures are
    // keyed by it, so a retried call never closes twice.
    opId: z.string().trim().regex(/^[A-Za-z0-9]{1,40}$/),
  }).strict(),
  z.object({ action: z.literal('unmark'), items }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'students_staff', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user: signedIn, log }) => {
    const db = getDb();
    const user = withDevice(signedIn, req);
    for (const slug of new Set(body.items.map((i) => i.session))) await assertSessionExists(db, slug);

    const result = body.action === 'mark'
      ? await markStaff({ db, user, items: body.items, alsoOtherSession: body.alsoOtherSession === true, opId: body.opId })
      : await unmarkStaff({ db, items: body.items });
    const count = body.action === 'mark' ? result.marked : result.unmarked;

    // Counts and totals only: no phone, no name.
    log.info(body.action === 'mark' ? 'Staff marked' : 'Staff unmarked', {
      count, skipped: result.skipped.length, closedTotal: result.closedTotal ?? 0,
    });
    if (count) {
      await tryWriteAudit({
        action: body.action === 'mark' ? 'students.staff_marked' : 'students.staff_unmarked',
        actor: user.uid,
        actorRole: user.role,
        target: 'students',
        after: {
          count,
          sessions: result.sessions,
          ...(body.action === 'mark' ? { closedTotal: result.closedTotal, alsoOtherSession: body.alsoOtherSession === true } : {}),
        },
        context: { requestId: log.requestId, device: user.device },
      }, log);
    }

    const { sessions, ...reply } = result; // eslint-disable-line no-unused-vars
    return { ok: true, ...reply, limit: MAX_STAFF_ITEMS };
  },
});
