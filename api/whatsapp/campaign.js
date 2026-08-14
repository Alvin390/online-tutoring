import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema } from '../_lib/validate.js';
import { badRequest, notFound, forbidden } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * WhatsApp campaigns — Phase 08 D2/D4/D6.
 *
 * A campaign is created server-side with its full recipient list resolved and
 * frozen at creation. That is what makes the queue RESUMABLE: closing the tab
 * and returning later continues from the same position against the same list,
 * rather than re-deriving a list that may have changed underneath.
 *
 * TIER GATING IS ENFORCED HERE, not in the UI.
 *   Silver → `all` filter only
 *   Gold   → session / class / individual filters, and attachments
 *
 * A Silver teacher with devtools cannot post `filter: { type: 'class' }` and
 * get a filtered send; the handler refuses it.
 */

const filterSchema = z
  .object({
    type: z.enum(['all', 'session', 'class', 'individual']),
    values: z.array(z.string().trim().max(80)).max(200).optional(),
    onlyOverdue: z.boolean().optional(),
  })
  .strict();

const attachmentSchema = z
  .object({
    storagePath: z.string().trim().max(400),
    downloadUrl: z.string().trim().url().max(2000),
    filename: z.string().trim().max(200),
    sizeBytes: z.number().int().min(0).max(10 * 1024 * 1024),
    contentType: z.string().trim().max(100),
  })
  .strict();

const schema = z
  .object({
    action: z.enum(['create', 'markRecipient', 'complete', 'abandon', 'delete', 'list', 'get']),
    campaignId: z.string().trim().max(64).optional(),
    title: z.string().trim().min(1).max(140).optional(),
    messageTemplate: z.string().trim().min(1).max(4096).optional(),
    filter: filterSchema.optional(),
    attachments: z.array(attachmentSchema).max(5).optional(),
    // markRecipient
    phone: phoneSchema.optional(),
    status: z.enum(['sent', 'skipped', 'failed', 'opened']).optional(),
    skipReason: z.string().trim().max(200).optional(),
    // re-run helper
    onlySkippedFrom: z.string().trim().max(64).optional(),
    session: sessionSchema.optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'whatsapp_campaign', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const { action } = body;

    const advanced = await isEnabled('whatsapp.advanced');
    const isGold = user.role === 'superadmin' || (user.tierRank ?? 0) >= 3;

    // ------------------------------------------------------------- create
    if (action === 'create') {
      if (!body.title || !body.messageTemplate) {
        throw badRequest('A campaign needs a title and a message.');
      }

      const filter = body.filter ?? { type: 'all' };

      // The tier gate. Silver gets all-students only.
      if (filter.type !== 'all' && !(isGold && advanced)) {
        throw forbidden(
          'Filtering recipients is a Gold feature. Silver sends to all students.',
          'tier_required'
        );
      }
      if ((body.attachments ?? []).length > 0 && !(isGold && advanced)) {
        throw forbidden(
          'Attaching documents is a Gold feature.',
          'tier_required'
        );
      }

      const recipients = await resolveRecipients(db, filter, body.onlySkippedFrom);

      if (recipients.length === 0) {
        throw badRequest('That filter matched no students who can receive messages.');
      }

      const campaignRef = db.collection('whatsapp/campaigns/items').doc();

      await campaignRef.set({
        title: body.title,
        messageTemplate: body.messageTemplate,
        attachments: body.attachments ?? [],
        filter,
        recipientCount: recipients.length,
        status: 'in_progress',
        sentCount: 0,
        skippedCount: 0,
        createdBy: user.uid,
        createdAt: FieldValue.serverTimestamp(),
        startedAt: FieldValue.serverTimestamp(),
        completedAt: null,
      });

      // Recipients are written in batches of 400 — Firestore's limit is 500
      // operations per batch, and leaving headroom avoids a partial write if
      // this ever grows an extra op per recipient.
      for (let i = 0; i < recipients.length; i += 400) {
        const batch = db.batch();
        recipients.slice(i, i + 400).forEach((recipient, offset) => {
          batch.set(campaignRef.collection('recipients').doc(recipient.phone), {
            ...recipient,
            status: 'queued',
            order: i + offset,
            openedAt: null,
            markedAt: null,
          });
        });
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
      }

      log.info('Campaign created', { recipients: recipients.length, filter: filter.type });

      await tryWriteAudit(
        { action: 'whatsapp.campaign_created', actor: user.uid, actorRole: user.role,
          target: campaignRef.id,
          after: { recipients: recipients.length, filter: filter.type },
          context: { requestId: log.requestId } },
        log
      );

      return { ok: true, campaignId: campaignRef.id, recipientCount: recipients.length };
    }

    if (action === 'list') {
      const snapshot = await db
        .collection('whatsapp/campaigns/items')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      return {
        ok: true,
        campaigns: snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null,
          completedAt: d.data().completedAt?.toDate?.()?.toISOString() ?? null,
        })),
      };
    }

    if (!body.campaignId) throw badRequest('Which campaign?');
    const campaignRef = db.doc(`whatsapp/campaigns/items/${body.campaignId}`);

    if (action === 'get') {
      const [campaignSnap, recipientsSnap] = await Promise.all([
        campaignRef.get(),
        campaignRef.collection('recipients').orderBy('order').get(),
      ]);

      if (!campaignSnap.exists) throw notFound('That campaign no longer exists.');

      return {
        ok: true,
        campaign: { id: campaignSnap.id, ...campaignSnap.data() },
        recipients: recipientsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    }

    // ------------------------------------------------- markRecipient
    if (action === 'markRecipient') {
      if (!body.phone || !body.status) throw badRequest('Which recipient, and what happened?');

      const recipientRef = campaignRef.collection('recipients').doc(body.phone);

      // Counters increment in the same transaction as the status change, so a
      // resumed queue never double-counts a recipient marked twice.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(recipientRef);
        if (!snap.exists) throw notFound('That recipient is not in this campaign.');

        const previous = snap.data().status;
        if (previous === body.status) return;

        tx.set(
          recipientRef,
          {
            status: body.status,
            ...(body.status === 'opened' ? { openedAt: FieldValue.serverTimestamp() } : {}),
            ...(body.status !== 'opened' ? { markedAt: FieldValue.serverTimestamp() } : {}),
            ...(body.skipReason ? { skipReason: body.skipReason } : {}),
          },
          { merge: true }
        );

        const delta = {};
        if (body.status === 'sent' && previous !== 'sent') delta.sentCount = FieldValue.increment(1);
        if (body.status === 'skipped' && previous !== 'skipped') {
          delta.skippedCount = FieldValue.increment(1);
        }
        if (previous === 'sent' && body.status !== 'sent') delta.sentCount = FieldValue.increment(-1);
        if (previous === 'skipped' && body.status !== 'skipped') {
          delta.skippedCount = FieldValue.increment(-1);
        }

        if (Object.keys(delta).length > 0) tx.set(campaignRef, delta, { merge: true });
      });

      return { ok: true };
    }

    if (action === 'complete' || action === 'abandon') {
      await campaignRef.set(
        {
          status: action === 'complete' ? 'completed' : 'abandoned',
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      log.info(`Campaign ${action}d`);
      return { ok: true };
    }

    // ------------------------------------------------------------- delete
    //
    // Removes the campaign AND its recipients subcollection. Deleting the
    // parent document alone would orphan the recipients — Firestore keeps
    // subcollections when their parent goes, so they would linger unreachable
    // and still counted against storage.
    //
    // Audited BEFORE the delete, with the counts, because afterwards there is
    // nothing left to say who was already messaged. Those messages did go out;
    // the record of them should not vanish silently just because the campaign
    // did.
    if (action === 'delete') {
      const snap = await campaignRef.get();
      if (!snap.exists) throw notFound('That campaign no longer exists.');

      const data = snap.data();

      await tryWriteAudit(
        { action: 'whatsapp.campaign_deleted', actor: user.uid, actorRole: user.role,
          target: body.campaignId,
          before: {
            title: data.title ?? null,
            status: data.status ?? null,
            sentCount: data.sentCount ?? 0,
            recipientCount: data.recipientCount ?? 0,
          },
          context: { requestId: log.requestId } },
        log
      );

      await db.recursiveDelete(campaignRef);

      log.warn('Campaign deleted', { sentCount: data.sentCount ?? 0 });
      return { ok: true, deleted: body.campaignId };
    }

    throw badRequest('Unknown action.');
  },
});

/**
 * Resolves a filter into a frozen recipient list.
 *
 * Opted-out students are excluded HERE, at resolution, not at send time.
 * Kenya's Data Protection Act 2019 makes opt-out a legal requirement rather
 * than a courtesy, and a list that contains them and relies on the UI to skip
 * them is one bug away from a breach.
 */
async function resolveRecipients(db, filter, onlySkippedFrom) {
  const sessionsSnap = await db.collection('sessions').get();
  const sessionIds = sessionsSnap.empty
    ? ['morning', 'evening']
    : sessionsSnap.docs.map((d) => d.id);

  const sessionNames = new Map(
    sessionsSnap.docs.map((d) => [d.id, d.data().name ?? d.id])
  );

  // Re-run against only those skipped last time — the common real workflow.
  let allowedPhones = null;
  if (onlySkippedFrom) {
    const previous = await db
      .doc(`whatsapp/campaigns/items/${onlySkippedFrom}`)
      .collection('recipients')
      .where('status', 'in', ['skipped', 'failed', 'queued'])
      .get();
    allowedPhones = new Set(previous.docs.map((d) => d.id));
  }

  const recipients = [];

  for (const sessionId of sessionIds) {
    if (filter.type === 'session' && !(filter.values ?? []).includes(sessionId)) continue;

    // eslint-disable-next-line no-await-in-loop
    const studentsSnap = await db.collection(`sessions/${sessionId}/students`).get();

    for (const studentDoc of studentsSnap.docs) {
      const student = studentDoc.data();
      const phone = studentDoc.id;

      if (student.whatsappOptOut === true) continue;
      if ((student.approvalStatus ?? 'approved') !== 'approved') continue;
      if (allowedPhones && !allowedPhones.has(phone)) continue;

      if (filter.type === 'class' && !(filter.values ?? []).includes(student.class)) continue;
      if (filter.type === 'individual' && !(filter.values ?? []).includes(phone)) continue;
      if (filter.onlyOverdue === true && student.overdue !== true) continue;

      recipients.push({
        phone,
        studentName: student.studentName ?? null,
        class: student.class ?? null,
        session: sessionId,
        sessionName: sessionNames.get(sessionId) ?? sessionId,
        feeBalance: typeof student.feeBalance === 'number' ? student.feeBalance : 0,
        nextDueDate: student.nextDueDate ?? null,
      });
    }
  }

  return recipients;
}
