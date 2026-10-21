import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import {
  validateSlug,
  deleteRecursively,
  ensureDefaultSessions,
  setSessionLink,
  invalidateSession,
  SESSION_TZ,
  DEFAULT_CLASSES,
  MAX_CLASSES,
  MAX_CLASS_NAME,
} from '../_lib/sessions.js';
import { MAX_SUBJECTS, MAX_SUBJECT_NAME } from '../_lib/subjects.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Session management — Phase 05 Part A.
 *
 * Server-side rather than direct Firestore writes because three operations
 * cannot be expressed safely in rules:
 *
 *   1. **Delete with reassignment.** Moving students to another session before
 *      removing this one has to be atomic-ish and ordered; a client doing it in
 *      two steps can leave students stranded in a session that no longer exists.
 *   2. **Recursive delete.** Firestore does not cascade. Deleting a session
 *      through the SDK leaves every student — and every private note — intact
 *      and orphaned.
 *   3. **Reorder.** A batch, so the list never renders half-reordered.
 */

/**
 * When a session runs — shown on the homepage card (Phase 13 / 02 D8).
 *
 * `days` empty means "every day". Times are 24h `HH:MM` in Nairobi time; the
 * zone is fixed because the whole app is (recurrence, ICS, fees). `null`
 * clears the schedule, which hides the time line on the card.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const scheduleSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startTime: z.string().regex(HHMM, 'must be HH:MM'),
    endTime: z.string().regex(HHMM, 'must be HH:MM'),
    tz: z.literal(SESSION_TZ).optional(),
  })
  .strict()
  .refine((s) => new Set(s.days).size === s.days.length, { message: 'days must not repeat', path: ['days'] })
  .refine((s) => s.endTime > s.startTime, { message: 'must be after the start time', path: ['endTime'] })
  .transform((s) => ({ days: [...s.days].sort((a, b) => a - b), startTime: s.startTime, endTime: s.endTime, tz: SESSION_TZ }))
  .nullable()
  .optional();

/** Shown under the session name on the homepage. Empty string clears it. */
const descriptionSchema = z.string().trim().max(160).optional();

/**
 * The registration form's class list for this session. At least one, at most
 * MAX_CLASSES, no blank or duplicate (case-insensitive) entries; inner spaces
 * collapsed so "Form  One" and "Form One" cannot both appear.
 */
const classesSchema = z
  .array(z.string().trim().min(1, 'A class name cannot be blank.').max(MAX_CLASS_NAME))
  .min(1, 'Keep at least one class.')
  .max(MAX_CLASSES, `At most ${MAX_CLASSES} classes.`)
  .transform((list) => list.map((c) => c.replace(/\s+/g, ' ')))
  .refine((list) => new Set(list.map((c) => c.toLowerCase())).size === list.length, 'Each class may appear only once.')
  .optional();

/**
 * Phase 14: the subjects each class offers on the registration form, keyed by
 * class name. A class with no entry offers its default subjects (by name); an
 * empty list means the free-text subjects box. Keys that are not one of the
 * session's classes are dropped on save.
 */
/** Keeps only the entries for the session's classes, in the classes' order. */
function onlyClasses(map, classes) {
  return Object.fromEntries(classes.filter((c) => Object.prototype.hasOwnProperty.call(map, c)).map((c) => [c, map[c]]));
}

const subjectSchema = z
  .object({
    name: z.string().trim().min(1, 'A subject name cannot be blank.').max(MAX_SUBJECT_NAME)
      .transform((s) => s.replace(/\s+/g, ' ')),
    compulsory: z.boolean().default(false),
  })
  .strict();

const subjectsByClassSchema = z
  .record(z.string().trim().min(1).max(MAX_CLASS_NAME), z.array(subjectSchema).max(MAX_SUBJECTS, `At most ${MAX_SUBJECTS} subjects per class.`))
  .superRefine((map, ctx) => {
    for (const [cls, list] of Object.entries(map)) {
      if (new Set(list.map((s) => s.name.toLowerCase())).size !== list.length) {
        ctx.addIssue({ code: 'custom', message: `Each subject may appear only once in ${cls}.` });
      }
    }
  })
  .optional();

const schema = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'reorder', 'setLink', 'bootstrap']),
    slug: z.string().trim().max(40).optional(),
    name: z.string().trim().min(1).max(60).optional(),
    description: descriptionSchema,
    icon: z.string().trim().max(60).optional(),
    gradient: z.string().trim().max(200).optional(),
    active: z.boolean().optional(),
    schedule: scheduleSchema,
    classes: classesSchema,
    subjectsByClass: subjectsByClassSchema,
    url: z.string().trim().max(2048).optional(),
    order: z.array(z.string().trim().max(40)).max(50).optional(),
    reassignTo: z.string().trim().max(40).nullable().optional(),
    confirmName: z.string().trim().max(60).optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'bronze',
  schema,
  rateLimit: { bucket: 'sessions_manage', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const { action } = body;

    // ------------------------------------------------------------- bootstrap
    // Phase 13 / 02 D1. The dashboard calls this when a teacher sees an empty
    // session list. Run-once and idempotent — see ensureDefaultSessions.
    if (action === 'bootstrap') {
      const outcome = await ensureDefaultSessions(db, { actor: user.uid, log });
      return { ok: true, ...outcome };
    }

    // ---------------------------------------------------------------- create
    if (action === 'create') {
      const check = validateSlug(body.slug);
      if (!check.valid) throw badRequest(check.error, 'invalid_slug');
      if (!body.name) throw badRequest('A session name is required.');

      const ref = db.doc(`sessions/${check.slug}`);

      // The slug is the document ID, so uniqueness is enforced by Firestore
      // itself — create() fails if it already exists. No read-then-write race.
      try {
        await ref.create({
          name: body.name,
          slug: check.slug,
          description: body.description ?? '',
          icon: body.icon ?? 'bi-book-fill',
          gradient: body.gradient ?? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          order: 999,
          active: body.active ?? true,
          schedule: body.schedule ?? null,
          classes: body.classes ?? [...DEFAULT_CLASSES],
          ...(body.subjectsByClass
            ? { subjectsByClass: onlyClasses(body.subjectsByClass, body.classes ?? DEFAULT_CLASSES) }
            : {}),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        if (err?.code === 6 || err?.code === 'already-exists') {
          throw badRequest(`A session already uses "${check.slug}". Pick another web address.`, 'slug_taken');
        }
        throw err;
      }

      invalidateSession(check.slug);
      log.info('Session created', { slug: check.slug });
      await tryWriteAudit(
        { action: 'session.created', actor: user.uid, actorRole: user.role,
          target: `sessions/${check.slug}`, after: { name: body.name, slug: check.slug },
          context: { requestId: log.requestId } },
        log
      );

      return { ok: true, slug: check.slug };
    }

    // ---------------------------------------------------------------- update
    if (action === 'update') {
      if (!body.slug) throw badRequest('Which session?');
      const ref = db.doc(`sessions/${body.slug}`);
      const snap = await ref.get();
      if (!snap.exists) throw notFound('That session no longer exists.');

      const current = snap.data();
      const patch = { updatedAt: FieldValue.serverTimestamp() };
      const changed = [];
      // The slug is the document ID and is deliberately immutable: changing it
      // would break every registration link and QR code already handed out.
      // Renaming "Morning Session" therefore keeps /morning working.
      for (const field of ['name', 'description', 'icon', 'gradient', 'active']) {
        if (body[field] !== undefined && body[field] !== current[field]) {
          patch[field] = body[field];
          changed.push(field);
        }
      }
      if (body.schedule !== undefined
          && JSON.stringify(body.schedule ?? null) !== JSON.stringify(current.schedule ?? null)) {
        patch.schedule = body.schedule ?? null;
        changed.push('schedule');
      }
      if (body.classes !== undefined
          && JSON.stringify(body.classes) !== JSON.stringify(current.classes ?? null)) {
        patch.classes = body.classes;
        changed.push('classes');
      }
      if (body.subjectsByClass !== undefined) {
        const next = onlyClasses(body.subjectsByClass, body.classes ?? current.classes ?? DEFAULT_CLASSES);
        if (JSON.stringify(next) !== JSON.stringify(current.subjectsByClass ?? null)) {
          patch.subjectsByClass = next;
          changed.push('subjectsByClass');
        }
      }

      await ref.set(patch, { merge: true });
      invalidateSession(body.slug);
      log.info('Session updated', { slug: body.slug, changed });

      if (changed.length > 0) {
        await tryWriteAudit(
          { action: 'session.updated', actor: user.uid, actorRole: user.role,
            target: `sessions/${body.slug}`,
            before: Object.fromEntries(changed.map((f) => [f, current[f] ?? null])),
            after: { changed, ...Object.fromEntries(changed.map((f) => [f, patch[f] ?? null])) },
            context: { requestId: log.requestId } },
          log
        );
      }

      return { ok: true, slug: body.slug, changed };
    }

    // --------------------------------------------------------------- setLink
    if (action === 'setLink') {
      if (!body.slug) throw badRequest('Which session?');

      // Same code path as /api/class/setLink — one store, see setSessionLink.
      const result = await setSessionLink(db, body.slug, body.url, {
        actor: user.uid,
        actorRole: user.role,
        log,
        requestId: log.requestId,
      });

      log.info('Session class link updated', { slug: body.slug, provider: result.provider });
      return { ok: true, slug: body.slug, provider: result.provider, url: result.url };
    }

    // --------------------------------------------------------------- reorder
    if (action === 'reorder') {
      if (!Array.isArray(body.order)) throw badRequest('An ordered list of slugs is required.');

      const batch = db.batch();
      body.order.forEach((slug, index) => {
        batch.set(db.doc(`sessions/${slug}`), { order: index, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();

      return { ok: true, count: body.order.length };
    }

    // ---------------------------------------------------------------- delete
    if (action === 'delete') {
      if (!body.slug) throw badRequest('Which session?');

      const ref = db.doc(`sessions/${body.slug}`);
      const snap = await ref.get();
      if (!snap.exists) throw notFound('That session no longer exists.');

      const session = snap.data();

      // Typed confirmation. Deleting a session takes its students and their
      // private notes with it, so a mis-click must not be enough.
      if (body.confirmName !== session.name) {
        throw badRequest(
          'Type the session name exactly to confirm deletion.',
          'confirmation_mismatch'
        );
      }

      const studentsRef = ref.collection('students');
      const students = await studentsRef.get();

      if (!students.empty && body.reassignTo) {
        const targetSnap = await db.doc(`sessions/${body.reassignTo}`).get();
        if (!targetSnap.exists) throw badRequest('The session you chose to move students to does not exist.');
        if (body.reassignTo === body.slug) throw badRequest('Cannot move students into the session being deleted.');

        // Copy each student — and their notes — into the target session, then
        // delete the source. Copy-before-delete, never the reverse: an
        // interruption halfway should leave duplicates, which are recoverable,
        // rather than a hole, which is not.
        for (const studentDoc of students.docs) {
          const targetStudent = db.doc(`sessions/${body.reassignTo}/students/${studentDoc.id}`);
          // eslint-disable-next-line no-await-in-loop
          await targetStudent.set({ ...studentDoc.data(), session: body.reassignTo }, { merge: true });

          // eslint-disable-next-line no-await-in-loop
          const notes = await studentDoc.ref.collection('notes').get();
          if (!notes.empty) {
            const noteBatch = db.batch();
            notes.forEach((note) => {
              noteBatch.set(targetStudent.collection('notes').doc(note.id), note.data());
            });
            // eslint-disable-next-line no-await-in-loop
            await noteBatch.commit();
          }
        }

        log.info('Students reassigned before session delete', {
          from: body.slug,
          to: body.reassignTo,
          count: students.size,
        });
      }

      // Recursive: Firestore does NOT cascade, and without this every student
      // document and every private note under this session would survive the
      // delete, orphaned but fully readable.
      await deleteRecursively(db, ref);
      invalidateSession(body.slug);

      log.info('Session deleted', { slug: body.slug, students: students.size });
      await tryWriteAudit(
        { action: 'session.deleted', actor: user.uid, actorRole: user.role,
          target: `sessions/${body.slug}`,
          before: { name: session.name, studentCount: students.size },
          context: { requestId: log.requestId, reassignedTo: body.reassignTo ?? null } },
        log
      );

      return { ok: true, deleted: body.slug, studentsAffected: students.size };
    }

    throw badRequest('Unknown action.');
  },
});
