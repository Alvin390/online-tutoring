import { createHandler } from '../_lib/handler.js';
import { getDb, getStorage } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError, badRequest } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getFlags } from '../_lib/flags.js';
import { tryWriteAudit } from '../_lib/audit.js';
import {
  MAX_ATTACHMENTS,
  SEVERITIES,
  URGENCIES,
  nextReportNumber,
  responseDueAt,
  sendReportEmail,
} from '../_lib/reports.js';

/**
 * Submit a bug report or a feature request — Phase 13 / 06 D3.
 *
 * Saves the report FIRST (so nothing is ever lost), then sends the email in
 * `waitUntil` — the teacher gets the report number at once, not after Gmail
 * answers. A failed send is retried by notificationsSweep with backoff.
 *
 * Idempotent: the report id is the client's UUID. A retried submit (double
 * tap, flaky network) returns the same report and never sends twice.
 *
 * Teachers only, so no bot protection is needed; per-teacher limits stop a
 * runaway client: 10 an hour, 30 a day.
 */

const context = z
  .object({
    page: z.string().trim().max(300).optional(),
    userAgent: z.string().trim().max(400).optional(),
    viewport: z.string().trim().max(40).optional(),
    appVersion: z.string().trim().max(40).optional(),
    buildHash: z.string().trim().max(40).optional(),
  })
  .strict()
  .default({});

const attachment = z
  .object({
    index: z.number().int().min(0).max(MAX_ATTACHMENTS - 1),
  })
  .strict();

const common = {
  reportId: z.string().uuid(),
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(5000),
  context,
  attachments: z.array(attachment).max(MAX_ATTACHMENTS).default([]),
};

const schema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('bug'),
    ...common,
    steps: z.string().trim().max(5000).optional(),
    expected: z.string().trim().max(2000).optional(),
    severity: z.enum(SEVERITIES),
  }).strict(),
  z.object({
    type: z.literal('feature'),
    ...common,
    problem: z.string().trim().max(3000).optional(),
    urgency: z.enum(URGENCIES),
  }).strict(),
]);

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'reports_submit_ip', limit: 30, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log, waitUntil }) => {
    const db = getDb();
    const ref = db.doc(`reports/${body.reportId}`);

    // Idempotency first: a retry must not be rate-limited or renumbered.
    const existing = await ref.get();
    if (existing.exists) {
      if (existing.data().submittedBy?.uid !== user.uid) {
        throw new ApiError(409, 'report_id_taken', 'That report id is already in use.');
      }
      return { ok: true, duplicate: true, id: body.reportId, number: existing.data().number,
        responseDueAt: existing.data().responseDueAt?.toDate?.()?.toISOString() ?? null };
    }

    await enforceRateLimit({ key: user.uid, bucket: 'reports_hour', limit: 10, windowSeconds: 3600 });
    await enforceRateLimit({ key: user.uid, bucket: 'reports_day', limit: 30, windowSeconds: 86_400 });

    // Screenshots: only what this teacher actually uploaded for THIS report.
    // Read even with no attachments claimed — a teacher who added and then
    // removed every screenshot still left files behind to clean up.
    const uploadsRef = db.doc(`reportUploads/${body.reportId}`);
    const uploads = await uploadsRef.get();
    const ownUploads = uploads.exists && uploads.data().uid === user.uid;
    const files = ownUploads ? uploads.data().files ?? {} : {};
    let attachments = [];
    if (body.attachments.length > 0) {
      if (!ownUploads) {
        throw badRequest('Those screenshots were not uploaded for this report.', 'attachments_missing');
      }
      attachments = [...new Set(body.attachments.map((a) => a.index))].map((index) => {
        const file = files[index];
        if (!file?.fullPath) throw badRequest(`Screenshot ${index + 1} has not finished uploading.`, 'attachments_missing');
        return {
          index,
          path: file.fullPath,
          thumbPath: file.thumbPath ?? null,
          contentType: file.contentType ?? null,
          bytes: file.fullBytes ?? null,
          width: file.width ?? null,
          height: file.height ?? null,
        };
      });
    }

    const now = Date.now();
    const number = await nextReportNumber(db, body.type);
    const flags = await getFlags();

    const report = {
      type: body.type,
      number,
      title: body.title,
      description: body.description,
      ...(body.type === 'bug'
        ? { steps: body.steps ?? null, expected: body.expected ?? null, severity: body.severity }
        : { problem: body.problem ?? null, urgency: body.urgency }),
      context: { ...body.context, tier: user.tier ?? null, flags },
      submittedBy: { uid: user.uid, email: user.email ?? null, displayName: user.token?.name ?? null },
      attachments,
      status: 'new',
      internalNotes: [],
      responseDueAt: new Date(responseDueAt(body.type, now)),
      email: { status: 'pending', attempts: 0 },
      clientRequestId: body.reportId,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    try {
      await ref.create(report);
    } catch (err) {
      if (err?.code === 6 || err?.code === 'already-exists') {
        // Lost a race with an identical retry: answer with the winner.
        const winner = (await ref.get()).data();
        return { ok: true, duplicate: true, id: body.reportId, number: winner.number };
      }
      throw err;
    }

    // The upload record has done its job. Deleting it (rather than marking it)
    // means `reportUploads` only ever holds unsubmitted drafts, which is what
    // lets the orphan purge be a single range query with no composite index.
    // Slots uploaded and then removed in the form are deleted from Storage
    // too — once the record is gone, nothing else would ever find them.
    if (ownUploads) {
      await uploadsRef.delete();
      const kept = new Set(attachments.map((a) => a.index));
      const discarded = Object.entries(files)
        .filter(([index]) => !kept.has(Number(index)))
        .flatMap(([, f]) => [f?.fullPath, f?.thumbPath])
        .filter(Boolean);
      if (discarded.length > 0) {
        const bucket = getStorage().bucket();
        waitUntil(Promise.all(discarded.map((path) => bucket.file(path).delete())));
      }
    }

    // Email AFTER the response, kept alive by the runtime.
    waitUntil(sendReportEmail(db, body.reportId, { log }));

    log.info('Report submitted', { type: body.type, number, attachments: attachments.length });
    waitUntil(tryWriteAudit(
      { action: 'reports.submitted', actor: user.uid, actorRole: user.role,
        target: `reports/${body.reportId}`, after: { type: body.type, number },
        context: { requestId: log.requestId } },
      log
    ));

    return { ok: true, id: body.reportId, number, responseDueAt: report.responseDueAt.toISOString() };
  },
});
