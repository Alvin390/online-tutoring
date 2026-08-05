import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Calendar event writes — Phase 07 D3. Teacher only, Silver and above.
 *
 * The interesting part is `scope`, which handles the three ways a recurring
 * event can be edited or deleted:
 *
 *   'occurrence'  — this one only. Adds an exception to the series.
 *   'future'      — this and everything after. SPLITS the series into two rules.
 *   'all'         — the whole series.
 *
 * Omitting that choice is the single most common calendar bug: editing next
 * Tuesday silently rewrites every Tuesday that has already happened, and the
 * teacher discovers it when last term's timetable has changed under them.
 */

const recurrenceSchema = z
  .object({
    freq: z.literal('weekly'),
    interval: z.number().int().min(1).max(12).optional(),
    byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: z.string().datetime().nullable().optional(),
  })
  .strict()
  .nullable();

const schema = z
  .object({
    action: z.enum(['create', 'update', 'delete']),
    id: z.string().trim().max(64).optional(),
    title: z.string().trim().min(1).max(140).optional(),
    description: z.string().trim().max(2000).optional(),
    start: z.string().datetime().optional(),
    end: z.string().datetime().optional(),
    allDay: z.boolean().optional(),
    colour: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    sessionIds: z.array(sessionSchema).max(20).optional(),
    recurrence: recurrenceSchema.optional(),
    scope: z.enum(['occurrence', 'future', 'all']).optional(),
    occurrenceStart: z.string().datetime().optional(),
  })
  .strict();

const collectionPath = 'calendar/events/items';

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'calendar_manage', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const { action, scope = 'all' } = body;

    // ------------------------------------------------------------- create
    if (action === 'create') {
      if (!body.title || !body.start) throw badRequest('A title and start time are required.');

      const start = new Date(body.start);
      const end = body.end ? new Date(body.end) : new Date(start.getTime() + 60 * 60 * 1000);
      if (end < start) throw badRequest('The event cannot end before it starts.');

      const ref = db.collection(collectionPath).doc();

      await ref.set({
        title: body.title,
        description: body.description ?? null,
        start,
        end,
        allDay: body.allDay === true,
        colour: body.colour ?? '#667eea',
        // Empty array means every student sees it.
        sessionIds: body.sessionIds ?? [],
        recurrence: normaliseRecurrence(body.recurrence),
        // Denormalised so the read query can fetch recurring series without a
        // second index on a nested field.
        isRecurring: Boolean(body.recurrence),
        recurrenceExceptions: [],
        createdBy: user.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      log.info('Calendar event created', { recurring: Boolean(body.recurrence) });
      await tryWriteAudit(
        { action: 'calendar.event_created', actor: user.uid, actorRole: user.role,
          target: ref.id, context: { requestId: log.requestId } },
        log
      );

      return { ok: true, id: ref.id };
    }

    if (!body.id) throw badRequest('Which event?');
    const ref = db.doc(`${collectionPath}/${body.id}`);
    const snap = await ref.get();
    if (!snap.exists) throw notFound('That event no longer exists.');
    const existing = snap.data();

    // ------------------------------------------------------------- delete
    if (action === 'delete') {
      if (scope === 'occurrence') {
        if (!body.occurrenceStart) throw badRequest('Which occurrence?');
        // Cancels one instance without touching the series.
        await ref.update({
          recurrenceExceptions: FieldValue.arrayUnion(new Date(body.occurrenceStart)),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, cancelledOccurrence: body.occurrenceStart };
      }

      if (scope === 'future') {
        if (!body.occurrenceStart) throw badRequest('Which occurrence?');
        // Ends the series the instant before this occurrence. Past occurrences
        // survive untouched, which is the whole point.
        const boundary = new Date(body.occurrenceStart);
        await ref.update({
          recurrence: { ...(existing.recurrence ?? {}), until: new Date(boundary.getTime() - 1) },
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, seriesEndedAt: boundary.toISOString() };
      }

      await ref.delete();
      log.info('Calendar event deleted');
      await tryWriteAudit(
        { action: 'calendar.event_deleted', actor: user.uid, actorRole: user.role,
          target: body.id, before: { title: existing.title },
          context: { requestId: log.requestId } },
        log
      );
      return { ok: true, deleted: body.id };
    }

    // ------------------------------------------------------------- update
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    for (const field of ['title', 'description', 'allDay', 'colour', 'sessionIds']) {
      if (body[field] !== undefined) patch[field] = body[field];
    }
    if (body.start) patch.start = new Date(body.start);
    if (body.end) patch.end = new Date(body.end);
    if (body.recurrence !== undefined) {
      patch.recurrence = normaliseRecurrence(body.recurrence);
      patch.isRecurring = Boolean(body.recurrence);
    }

    if (patch.start && patch.end && patch.end < patch.start) {
      throw badRequest('The event cannot end before it starts.');
    }

    // 'occurrence' and 'future' on a recurring series become a SPLIT: the
    // original stops, and a new series carries the change forward. Editing in
    // place would rewrite history.
    if (scope !== 'all' && existing.isRecurring && body.occurrenceStart) {
      const boundary = new Date(body.occurrenceStart);

      const batch = db.batch();

      if (scope === 'future') {
        batch.update(ref, {
          recurrence: { ...(existing.recurrence ?? {}), until: new Date(boundary.getTime() - 1) },
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        batch.update(ref, {
          recurrenceExceptions: FieldValue.arrayUnion(boundary),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const newRef = db.collection(collectionPath).doc();
      const newStart = patch.start ?? boundary;
      const duration = (existing.end?.toMillis?.() ?? 0) - (existing.start?.toMillis?.() ?? 0);

      batch.set(newRef, {
        title: patch.title ?? existing.title,
        description: patch.description ?? existing.description ?? null,
        start: newStart,
        end: patch.end ?? new Date(newStart.getTime() + Math.max(duration, 60 * 60 * 1000)),
        allDay: patch.allDay ?? existing.allDay ?? false,
        colour: patch.colour ?? existing.colour ?? '#667eea',
        sessionIds: patch.sessionIds ?? existing.sessionIds ?? [],
        recurrence: scope === 'future'
          ? (patch.recurrence !== undefined ? patch.recurrence : existing.recurrence)
          : null,
        isRecurring: scope === 'future'
          ? Boolean(patch.recurrence !== undefined ? patch.recurrence : existing.recurrence)
          : false,
        recurrenceExceptions: [],
        createdBy: user.uid,
        splitFrom: body.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      log.info('Calendar series split', { scope });
      return { ok: true, id: newRef.id, splitFrom: body.id, scope };
    }

    await ref.update(patch);
    log.info('Calendar event updated', { scope });

    return { ok: true, id: body.id };
  },
});

function normaliseRecurrence(recurrence) {
  if (!recurrence) return null;
  return {
    freq: 'weekly',
    interval: recurrence.interval ?? 1,
    byDay: recurrence.byDay ?? [],
    until: recurrence.until ? new Date(recurrence.until) : null,
  };
}
