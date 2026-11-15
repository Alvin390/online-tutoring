import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema } from '../_lib/validate.js';
import { ApiError, badRequest, forbidden, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { getFlags } from '../_lib/flags.js';
import { withDevice } from '../_lib/device.js';
import {
  prepareMessages, smsRecipients, assertAboveReserve, createCampaign, sendChunk, checkDelivery,
  campaignsCol, campaignView, recipientView, SMS_CHUNK,
} from '../_lib/smsCampaign.js';
import { lastKnownBalance, SMS_RESERVE_KES, recordSmsBalance, recordSmsUsage } from '../_lib/smsCredit.js';
import { SMS_MAX_CHARS, SMS_RATE_KES, unsupportedChars, normalizeSmsText } from '../_lib/smsText.js';
import { sendSms, SmsError, smsAvailable } from '../_lib/sms.js';

/**
 * SMS to parents (and staff) through HashBack — 008Fixes / 07.
 *
 *   preview    every parent's version checked: the longest (and whose), units,
 *              cost, how many, the balance. Nothing is sent.
 *   start      the same checks, the reserve, then the campaign is created
 *   sendChunk  the next SMS_CHUNK parents (the dashboard calls it until done)
 *   cancel     the rest are not sent
 *   sendOne    one student or staff member (the Staff tab's SMS button)
 *   list/get   history, and one message's people with their delivery
 *   refresh    ask HashBack about delivery now (also done every minute for
 *              30 minutes after a send, with no new cron)
 *   people     who can be messaged (008Fixes / 09): students and staff, by
 *              the same rules as a send (opted-out and unapproved left out),
 *              for "Choose students" and WhatsApp to one person
 *
 * Setup (008Fixes / 08, owner HashBack answers 1–2): messaging is LOCKED until
 *   setup          what is set: the school name, unlocked or not, the sender
 *   saveSchoolName the {{schoolName}} placeholder (up to 30, plain characters);
 *                  can be changed later without locking again
 *   sendTest       "Test from <school>: SMS is working." to the teacher's phone
 *   unlock         after a test HashBack accepted in the last hour
 * The setup is the school's (config/smsSetup): every staff account shares it,
 * as they share everything (owner, 2026-10-31).
 *
 * The same tiers as WhatsApp (owner answer 16): Silver sends to everyone;
 * choosing sessions, classes, students or staff is Gold (with
 * `whatsapp.advanced`, as WhatsApp's filters). Behind `sms.enabled`.
 */

const filterSchema = z.object({
  type: z.enum(['all', 'session', 'class', 'individual', 'staff']),
  values: z.array(z.string().trim().max(80)).max(1000).optional(),
}).strict();

const template = z.string().trim().min(1).max(2000);
const id = z.string().trim().regex(/^[A-Za-z0-9]{1,40}$/);

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), template, filter: filterSchema }).strict(),
  z.object({ action: z.literal('start'), template, filter: filterSchema, title: z.string().trim().max(140).optional() }).strict(),
  z.object({ action: z.literal('sendChunk'), campaignId: id }).strict(),
  z.object({ action: z.literal('cancel'), campaignId: id }).strict(),
  z.object({ action: z.literal('sendOne'), session: sessionSchema, phone: phoneSchema, template }).strict(),
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), campaignId: id }).strict(),
  z.object({ action: z.literal('refresh'), campaignId: id }).strict(),
  z.object({ action: z.literal('setup') }).strict(),
  z.object({ action: z.literal('people') }).strict(),
  z.object({ action: z.literal('saveSchoolName'), schoolName: z.string().trim().min(2).max(30) }).strict(),
  z.object({ action: z.literal('sendTest'), phone: phoneSchema }).strict(),
  z.object({ action: z.literal('unlock') }).strict(),
]);

const SETUP_DOC = 'config/smsSetup';
const READ_WHEN_OFF = new Set(['people', 'list', 'get']);
const TEST_VALID_MS = 60 * 60_000;
const iso = (v) => v?.toDate?.()?.toISOString?.() ?? null;

function setupView(data) {
  const d = data ?? {};
  return {
    schoolName: d.schoolName ?? '',
    unlocked: Boolean(d.unlockedAt),
    unlockedAt: iso(d.unlockedAt),
    unlockedByEmail: d.unlockedByEmail ?? null,
    lastTestAt: iso(d.lastTestAt),
    lastTestEnding: d.lastTestEnding ?? null,
    sender: d.sender ?? 'HASHBACKSMS',
  };
}

/** The school name from the SMS setup (Phase 08), for {{schoolName}}. */
async function schoolNameOf(db) {
  const snap = await db.doc('config/smsSetup').get();
  return snap.exists ? (snap.data().schoolName ?? '') : '';
}

export default createHandler({
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'messages_sms', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user: signedIn, log, waitUntil }) => {
    const db = getDb();
    const user = withDevice(signedIn, req);
    const flags = await getFlags();
    // 008Fixes / 11 (owner: the old WhatsApp panel is removed): with SMS off the
    // Messages tab still offers WhatsApp to one person and the sent history, so
    // these reads work either way. Every send, the setup and every HashBack
    // call need SMS on.
    if (flags['sms.enabled'] !== true && !READ_WHEN_OFF.has(body.action)) throw forbidden('SMS is not switched on yet.', 'sms_off');
    const isGold = user.role === 'superadmin' || (user.tierRank ?? 0) >= 3;
    const filtersAllowed = isGold && flags['whatsapp.advanced'] === true;

    const setupRef = db.doc(SETUP_DOC);
    const readSetup = async () => {
      const snap = await setupRef.get();
      return snap.exists ? snap.data() : {};
    };
    const assertUnlocked = async () => {
      if (!(await readSetup()).unlockedAt) {
        throw new ApiError(409, 'sms_locked', 'Set up SMS first: add your school name and send a test to your phone.');
      }
    };

    if (body.action === 'setup') return { setup: setupView(await readSetup()) };

    if (body.action === 'people') {
      const [students, staff] = await Promise.all([smsRecipients(db, { type: 'all' }), smsRecipients(db, { type: 'staff' })]);
      const view = (r) => ({
        session: r.session, sessionName: r.sessionName, phone: r.phone, studentName: r.studentName ?? null,
        class: r.class ?? null, feeBalance: r.feeBalance ?? 0, nextDueDate: r.nextDueDate?.toMillis?.() ?? r.nextDueDate ?? null,
      });
      const byName = (a, b) => String(a.studentName ?? '').localeCompare(String(b.studentName ?? ''));
      return { students: students.map(view).sort(byName), staff: staff.map(view).sort(byName) };
    }

    if (body.action === 'saveSchoolName') {
      const name = normalizeSmsText(body.schoolName).replace(/\s+/g, ' ').trim();
      const bad = unsupportedChars(name);
      if (bad.length) throw new ApiError(400, 'unsupported_characters', `SMS can't carry ${bad.join(' ')}. Use plain letters.`);
      await setupRef.set({ schoolName: name, schoolNameAt: new Date(), schoolNameBy: user.uid }, { merge: true });
      waitUntil(tryWriteAudit({
        action: 'sms.school_name_set', actor: user.uid, actorRole: user.role, target: SETUP_DOC,
        after: { schoolName: name }, context: { requestId: log.requestId },
      }, log));
      return { setup: setupView(await readSetup()) };
    }

    if (body.action === 'sendTest') {
      if (!smsAvailable()) throw new ApiError(503, 'sms_unavailable', 'SMS is not available right now. Ask the owner to check the SMS setup.');
      const setup = await readSetup();
      const message = `Test from ${setup.schoolName || 'your school'}: SMS is working.`;
      let sent;
      try {
        sent = await sendSms({ to: body.phone, message });
      } catch (err) {
        const code = err instanceof SmsError ? err.code : 'error';
        log.warn('SMS test not sent', { code });
        throw new ApiError(code === 'INSUFFICIENT_FUNDS' ? 402 : 502, code === 'INSUFFICIENT_FUNDS' ? 'low_credit' : 'not_sent',
          code === 'INSUFFICIENT_FUNDS'
            ? 'The SMS credit has run out. Ask the owner to top it up.'
            : 'The test SMS was not sent. Check the number and try again.');
      }
      await setupRef.set({
        lastTestId: sent.id, lastTestAt: new Date(), lastTestBy: user.uid,
        lastTestEnding: body.phone.slice(-3), ...(sent.senderId ? { sender: sent.senderId } : {}),
      }, { merge: true });
      await Promise.all([
        recordSmsBalance(sent.balance, { db, log }),
        recordSmsUsage({ db, uid: user.uid, email: user.email ?? null, units: sent.units || 1, cost: sent.cost || SMS_RATE_KES, log }),
      ]);
      return { sent: true, phoneEnding: body.phone.slice(-3), sender: sent.senderId ?? 'HASHBACKSMS' };
    }

    if (body.action === 'unlock') {
      const setup = await readSetup();
      const testedAt = setup.lastTestAt?.toMillis?.() ?? 0;
      if (!setup.lastTestId || Date.now() - testedAt > TEST_VALID_MS) {
        throw new ApiError(409, 'test_first', 'Send a test SMS to your phone first.');
      }
      if (!setup.unlockedAt) {
        await setupRef.set({ unlockedAt: new Date(), unlockedBy: user.uid, unlockedByEmail: user.email ?? null }, { merge: true });
        waitUntil(tryWriteAudit({
          action: 'sms.unlocked', actor: user.uid, actorRole: user.role, target: SETUP_DOC,
          context: { requestId: log.requestId, device: user.device },
        }, log));
      }
      return { setup: setupView(await readSetup()) };
    }

    const audience = async (filter) => {
      if (filter.type !== 'all' && !filtersAllowed) {
        throw forbidden('Choosing who receives it is a Gold feature. Silver sends to all students.', 'tier_required');
      }
      const people = await smsRecipients(db, filter);
      if (people.length === 0) throw badRequest('Nobody matches that choice (or they asked not to get messages).', 'no_recipients');
      return people;
    };

    if (body.action === 'preview' || body.action === 'start' || body.action === 'sendOne') await assertUnlocked();

    if (body.action === 'preview' || body.action === 'start') {
      const [people, schoolName] = await Promise.all([audience(body.filter), schoolNameOf(db)]);
      const prepared = prepareMessages(body.template, people, schoolName);
      if (body.action === 'preview') {
        const balance = await lastKnownBalance(db);
        // 009Fixes / 00: no money for teachers (the school pays): credit is a yes/no.
        return {
          recipients: prepared.messages.length,
          units: prepared.units,
          longest: prepared.longest,
          maxChars: SMS_MAX_CHARS,
          enoughCredit: balance == null ? null : balance - prepared.cost >= SMS_RESERVE_KES,
          sample: prepared.messages.slice(0, 3).map((m) => ({ studentName: m.studentName ?? null, text: m.text, units: m.units })),
        };
      }
      await assertAboveReserve(db, prepared.cost, log);
      const ref = await createCampaign({
        db, user, kind: 'campaign', template: body.template, filter: body.filter, title: body.title, schoolName, prepared,
      });
      waitUntil(tryWriteAudit({
        action: 'sms.campaign_started', actor: user.uid, actorRole: user.role, target: ref.id,
        after: { recipients: prepared.messages.length, units: prepared.units, cost: prepared.cost, filter: body.filter.type },
        context: { requestId: log.requestId, device: user.device },
      }, log));
      log.info('SMS campaign started', { recipients: prepared.messages.length, units: prepared.units });
      return { campaignId: ref.id, recipients: prepared.messages.length, units: prepared.units, chunk: SMS_CHUNK };
    }

    if (body.action === 'sendChunk') {
      const result = await sendChunk({ db, user, campaignId: body.campaignId, log });
      log.info('SMS chunk', { sent: result.sent ?? 0, failed: result.failed ?? 0, remaining: result.remaining ?? 0 });
      return result;
    }

    if (body.action === 'sendOne') {
      const snap = await db.doc(`sessions/${body.session}/students/${body.phone}`).get();
      if (!snap.exists) throw notFound('That person is no longer registered.');
      const s = snap.data();
      if (s.whatsappOptOut === true) throw new ApiError(409, 'opted_out', 'They asked not to get messages.');
      const sessionSnap = await db.doc(`sessions/${body.session}`).get();
      const person = {
        phone: body.phone,
        session: body.session,
        sessionName: sessionSnap.exists ? (sessionSnap.data().name ?? body.session) : body.session,
        studentName: s.studentName ?? null,
        class: s.class ?? null,
        staff: s.staff === true,
        feeBalance: typeof s.feeBalance === 'number' ? s.feeBalance : 0,
        nextDueDate: s.nextDueDate ?? null,
      };
      const prepared = prepareMessages(body.template, [person], await schoolNameOf(db));
      await assertAboveReserve(db, prepared.cost, log);
      const ref = await createCampaign({ db, user, kind: 'one', template: body.template, filter: null, schoolName: null, prepared });
      const result = await sendChunk({ db, user, campaignId: ref.id, log });
      waitUntil(tryWriteAudit({
        action: 'sms.sent_one', actor: user.uid, actorRole: user.role, target: `${body.session}/${body.phone}`,
        after: { units: prepared.units, sent: result.sent ?? 0 }, context: { requestId: log.requestId, device: user.device },
      }, log));
      if (!result.sent) {
        throw new ApiError(502, 'not_sent', result.retryAfter
          ? `SMS is busy. Please try again in ${result.retryAfter} seconds.`
          : 'The SMS was not sent. Please check the number and try again.');
      }
      return { campaignId: ref.id, sent: 1, units: prepared.units };
    }

    if (body.action === 'list') {
      const snap = await campaignsCol(db).orderBy('createdAt', 'desc').limit(50).get();
      return { campaigns: snap.docs.map((d) => campaignView(d.id, d.data())) };
    }

    const ref = campaignsCol(db).doc(body.campaignId);

    if (body.action === 'cancel') {
      const queued = await ref.collection('recipients').where('status', '==', 'queued').get();
      const snap = await ref.get();
      if (!snap.exists) throw notFound('That message no longer exists.');
      const batch = db.batch();
      queued.docs.forEach((d) => batch.update(d.ref, { status: 'skipped', error: 'cancelled', statusAt: new Date() }));
      const counts = { ...(snap.data().counts ?? {}) };
      counts.skipped = (counts.skipped ?? 0) + queued.size;
      counts.queued = Math.max(0, (counts.queued ?? 0) - queued.size);
      batch.set(ref, { status: 'cancelled', counts }, { merge: true });
      await batch.commit();
      waitUntil(tryWriteAudit({
        action: 'sms.campaign_cancelled', actor: user.uid, actorRole: user.role, target: body.campaignId,
        after: { skipped: queued.size }, context: { requestId: log.requestId },
      }, log));
      return { cancelled: true, skipped: queued.size };
    }

    if (body.action === 'refresh') {
      const snap = await ref.get();
      if (!snap.exists) throw notFound('That message no longer exists.');
      await checkDelivery({ db, campaignId: body.campaignId, limit: 20, log });
    }

    // get (and refresh's answer)
    const [snap, people] = await Promise.all([ref.get(), ref.collection('recipients').orderBy('order').get()]);
    if (!snap.exists) throw notFound('That message no longer exists.');
    return {
      campaign: campaignView(snap.id, snap.data()),
      recipients: people.docs.map((d) => recipientView(d.id, d.data())),
    };
  },
});
