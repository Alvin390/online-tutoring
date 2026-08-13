import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { validateSlug, deleteRecursively } from '../_lib/sessions.js';
import { parseClassLink } from '../_lib/classLink.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

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

const scheduleSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    tz: z.string().max(64).default('Africa/Nairobi'),
  })
  .strict()
  .optional();

const schema = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'reorder', 'setLink']),
    slug: z.string().trim().max(40).optional(),
    name: z.string().trim().min(1).max(60).optional(),
    icon: z.string().trim().max(60).optional(),
    gradient: z.string().trim().max(200).optional(),
    active: z.boolean().optional(),
    schedule: scheduleSchema,
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
          icon: body.icon ?? 'bi-book-fill',
          gradient: body.gradient ?? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          order: 999,
          active: body.active ?? true,
          schedule: body.schedule ?? null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        if (err?.code === 6 || err?.code === 'already-exists') {
          throw badRequest(`A session already uses "${check.slug}". Pick another web address.`, 'slug_taken');
        }
        throw err;
      }

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

      const patch = { updatedAt: FieldValue.serverTimestamp() };
      // The slug is the document ID and is deliberately immutable: changing it
      // would break every registration link and QR code already handed out.
      for (const field of ['name', 'icon', 'gradient', 'active']) {
        if (body[field] !== undefined) patch[field] = body[field];
      }
      if (body.schedule !== undefined) patch.schedule = body.schedule ?? null;

      await ref.set(patch, { merge: true });
      log.info('Session updated', { slug: body.slug });

      return { ok: true, slug: body.slug };
    }

    // --------------------------------------------------------------- setLink
    if (action === 'setLink') {
      if (!body.slug) throw badRequest('Which session?');

      const result = parseClassLink(body.url);
      if (!result.valid) throw badRequest(result.error, 'invalid_class_link');

      // Written to the PRIVATE subcollection, never to the session document —
      // that one is world-readable so students can render the page, and putting
      // the link on it would recreate the leak Phase 01 closed.
      await db.doc(`sessions/${body.slug}/private/classLink`).set(
        {
          url: result.url,
          provider: result.provider,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: user.uid,
        },
        { merge: true }
      );

      log.info('Session class link updated', { slug: body.slug, provider: result.provider });
      await tryWriteAudit(
        { action: AuditAction.CLASS_LINK_UPDATED, actor: user.uid, actorRole: user.role,
          target: `sessions/${body.slug}`, after: { provider: result.provider },
          context: { requestId: log.requestId } },
        log
      );

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
