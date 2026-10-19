import { createHandler } from '../_lib/handler.js';
import { getDb, getStorage } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { REPORT_TYPES, statusesFor, sendReportEmail } from '../_lib/reports.js';

/**
 * Superadmin inboxes — Phase 13 / 06 D7. Bugs and feature requests are
 * separate inboxes (one `type` per list call), as asked.
 *
 *   list         one type, optional status, 20 per page (cursor on createdAt),
 *                plus a count per status for the filter chips
 *   get          the whole report, screenshots as 15-minute signed URLs
 *   setStatus    status for that type's workflow
 *   addNote      an internal note (superadmin-only, capped at 50)
 *   resendEmail  re-send the alert now
 */

const PAGE = 20;
const MAX_NOTES = 50;
const SIGNED_URL_MS = 15 * 60 * 1000;

const schema = z
  .object({
    action: z.enum(['list', 'get', 'setStatus', 'addNote', 'resendEmail']),
    type: z.enum(REPORT_TYPES).optional(),
    status: z.string().trim().max(20).optional(),
    cursor: z.string().datetime().optional(),
    id: z.string().uuid().optional(),
    text: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

const iso = (v) => v?.toDate?.()?.toISOString?.() ?? null;

function summary(id, r) {
  return {
    id,
    type: r.type,
    number: r.number,
    title: r.title,
    status: r.status,
    severity: r.severity ?? null,
    urgency: r.urgency ?? null,
    teacher: r.submittedBy?.displayName || r.submittedBy?.email || '—',
    createdAt: iso(r.createdAt),
    responseDueAt: iso(r.responseDueAt),
    emailStatus: r.email?.status ?? null,
    attachments: (r.attachments ?? []).length,
  };
}

async function signed(path) {
  if (!path) return null;
  try {
    const [url] = await getStorage().bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + SIGNED_URL_MS });
    return url;
  } catch {
    return null;
  }
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_reports', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();

    if (body.action === 'list') {
      if (!body.type) throw badRequest('Which inbox?');
      const statuses = statusesFor(body.type);
      if (body.status && !statuses.includes(body.status)) throw badRequest('Unknown status.');

      let query = db.collection('reports').where('type', '==', body.type);
      if (body.status) query = query.where('status', '==', body.status);
      query = query.orderBy('createdAt', 'desc').limit(PAGE);
      if (body.cursor) query = query.startAfter(new Date(body.cursor));

      const [page, ...counts] = await Promise.all([
        query.get(),
        ...statuses.map((s) => db.collection('reports').where('type', '==', body.type).where('status', '==', s).count().get()),
      ]);

      const items = page.docs.map((d) => summary(d.id, d.data()));
      return {
        ok: true,
        items,
        nextCursor: items.length === PAGE ? items[items.length - 1].createdAt : null,
        counts: Object.fromEntries(statuses.map((s, i) => [s, counts[i].data().count])),
      };
    }

    if (!body.id) throw badRequest('Which report?');
    const ref = db.doc(`reports/${body.id}`);
    const snap = await ref.get();
    if (!snap.exists) throw notFound('That report no longer exists.');
    const report = snap.data();

    if (body.action === 'get') {
      const attachments = await Promise.all((report.attachments ?? []).map(async (a) => ({
        index: a.index,
        width: a.width ?? null,
        height: a.height ?? null,
        url: await signed(a.path),
        thumbUrl: await signed(a.thumbPath ?? a.path),
      })));
      return {
        ok: true,
        report: {
          ...summary(body.id, report),
          description: report.description,
          steps: report.steps ?? null,
          expected: report.expected ?? null,
          problem: report.problem ?? null,
          context: report.context ?? {},
          submittedBy: report.submittedBy ?? {},
          internalNotes: (report.internalNotes ?? []).map((n) => ({ ...n, at: iso(n.at) ?? n.at })),
          email: { ...(report.email ?? {}), sentAt: iso(report.email?.sentAt), nextAttemptAt: iso(report.email?.nextAttemptAt) },
          attachments,
        },
      };
    }

    if (body.action === 'setStatus') {
      if (!statusesFor(report.type).includes(body.status)) throw badRequest('That status does not apply to this report.');
      await ref.set({ status: body.status, updatedAt: new Date() }, { merge: true });
      await tryWriteAudit(
        { action: 'reports.status_changed', actor: user.uid, actorRole: user.role, target: `reports/${body.id}`,
          before: { status: report.status }, after: { status: body.status }, context: { requestId: log.requestId } },
        log
      );
      return { ok: true, status: body.status };
    }

    if (body.action === 'addNote') {
      if (!body.text) throw badRequest('Write a note first.');
      const notes = await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data()?.internalNotes ?? [];
        if (current.length >= MAX_NOTES) throw badRequest(`A report can hold ${MAX_NOTES} notes.`);
        const next = [...current, { at: new Date(), by: user.uid, text: body.text }];
        tx.set(ref, { internalNotes: next, updatedAt: new Date() }, { merge: true });
        return next;
      });
      return { ok: true, notes: notes.length };
    }

    // resendEmail
    await ref.set({ email: { status: 'pending', nextAttemptAt: null } }, { merge: true });
    const result = await sendReportEmail(db, body.id, { log });
    return { ok: true, ...result };
  },
});
