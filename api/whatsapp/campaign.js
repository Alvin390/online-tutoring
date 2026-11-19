import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError, badRequest, notFound } from '../_lib/errors.js';

/**
 * WhatsApp campaigns — RETIRED (013Fixes / 06).
 *
 * The owner's plans have no WhatsApp campaigns on any plan: WhatsApp is one
 * person at a time (wa.me, every plan), and messages to many parents go by
 * SMS (Silver and up; choosing recipients Gold). The campaign screens were
 * removed in 008Fixes / 11.
 *
 * What is left: reading the school's OLD campaigns (`list`, `get`), which the
 * sent-messages history still shows. Their data is kept, not deleted. Every
 * other action — create, send, mark, complete, abandon, delete, options —
 * answers 410 Gone.
 */

const RETIRED = new Set(['create', 'markRecipient', 'complete', 'abandon', 'delete', 'options']);

const schema = z
  .object({
    action: z.enum(['list', 'get', ...RETIRED]),
    campaignId: z.string().trim().max(64).optional(),
  })
  // Old clients may still send their full create/mark payloads: accepted only
  // to be answered 410, never acted on.
  .passthrough();

export function retiredError() {
  return new ApiError(410, 'gone', 'WhatsApp campaigns have been retired. Message one person on WhatsApp, or many parents by SMS.');
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'whatsapp_campaign', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body }) => {
    const { action } = body;
    if (RETIRED.has(action)) throw retiredError();

    const db = getDb();

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

    // get
    if (!body.campaignId) throw badRequest('Which campaign?');
    const campaignRef = db.doc(`whatsapp/campaigns/items/${body.campaignId}`);
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
  },
});
