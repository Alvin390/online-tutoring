import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { ApiError, badRequest, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { withDevice } from '../_lib/device.js';
import { decrypt } from '../_lib/crypto.js';
import { lockRef } from '../_lib/checkinLock.js';
import {
  numberProblem, numberProblemMessage, recordNumber, reservationId, formatNumber,
} from '../_lib/admissionNumber.js';

/**
 * The teacher's side of admission numbers — 008Fixes / 02, 03, 05.
 *
 *   set         give a registration a number, or change it (owner answer 7).
 *               The old one is freed and the new one taken in ONE transaction;
 *               the easy-number rule applies. Staff get a staff number.
 *   allowAgain  "Allow again" (answer 8): deletes this class's one-device lock,
 *               so the student can check in on another device.
 *   codes       the one-time codes still waiting (answer 3): if a student's SMS
 *               doesn't arrive, she reads them their code. Read only when the
 *               panel is opened; nothing listens.
 *
 * All staff see everything (owner, 2026-10-31): nothing is scoped to an account.
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), session: sessionSchema, phone: phoneSchema, number: z.string().trim().max(8) }).strict(),
  z.object({ action: z.literal('allowAgain'), session: sessionSchema, phone: phoneSchema }).strict(),
  z.object({ action: z.literal('codes') }).strict(),
]);

const MAX_CODES = 50;
const ending = (phone) => String(phone).slice(-3);

export default createHandler({
  sessions: 'any',
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'students_admission', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ req, body, user: signedIn, log, waitUntil }) => {
    const db = getDb();
    const user = withDevice(signedIn, req);

    if (body.action === 'codes') {
      const now = Date.now();
      const snap = await db.collection('otp').where('expiresAt', '>', new Date(now)).limit(MAX_CODES).get();
      const waiting = snap.docs.map((d) => d.data()).filter((d) => !d.consumedAt && d.codeForStaff && d.session && d.phone);
      const students = waiting.length
        ? await db.getAll(...waiting.map((d) => db.doc(`sessions/${d.session}/students/${d.phone}`)))
        : [];
      const codes = [];
      waiting.forEach((d, i) => {
        let code = null;
        try { code = decrypt(d.codeForStaff); } catch { code = null; }
        if (!code) return;
        const record = students[i]?.exists ? students[i].data() : null;
        codes.push({
          session: d.session,
          phone: d.phone,
          phoneEnding: ending(d.phone),
          name: record?.studentName ?? null,
          code,
          expiresAtMs: d.expiresAt?.toMillis?.() ?? null,
          sentBy: d.deliveryChannel === 'sms' ? 'sms' : null,
        });
      });
      codes.sort((a, b) => (b.expiresAtMs ?? 0) - (a.expiresAtMs ?? 0));
      log.info('Waiting codes read', { count: codes.length });
      return { codes };
    }

    const { session, phone } = body;
    const studentRef = db.doc(`sessions/${session}/students/${phone}`);

    if (body.action === 'allowAgain') {
      const snap = await studentRef.get();
      if (!snap.exists) throw notFound('That student no longer exists.');
      await lockRef(db, session, phone).delete();
      waitUntil(tryWriteAudit({
        action: 'student.checkin_allowed_again', actor: user.uid, actorRole: user.role,
        target: `${session}/${phone}`, context: { requestId: log.requestId, device: user.device },
      }, log));
      log.info('Check-in allowed again', { session });
      return { ok: true };
    }

    // set
    const problem = numberProblem(body.number);
    if (problem) throw badRequest(numberProblemMessage(problem), problem === 'easy' ? 'easy_number' : 'invalid_number');
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) throw notFound('That student no longer exists.');
      const data = snap.data();
      const kind = data.staff === true ? 'staff' : 'student';
      const old = recordNumber(data);
      if (old && old.digits === body.number) return { kind, unchanged: true, old };
      const next = db.doc(`sessions/${session}/numbers/${reservationId(kind, body.number)}`);
      const oldRef = old ? db.doc(`sessions/${session}/numbers/${reservationId(old.kind, old.digits)}`) : null;
      const [taken, oldSnap] = await Promise.all([tx.get(next), oldRef ? tx.get(oldRef) : Promise.resolve(null)]);
      if (taken.exists && taken.data().phone !== phone) {
        throw new ApiError(409, 'number_taken', 'That number is taken. Choose another.');
      }
      // Free the old number only if it really is this student's.
      if (oldSnap?.exists && oldSnap.data().phone === phone) tx.delete(oldRef);
      tx.set(next, { phone, kind, number: body.number, at: FieldValue.serverTimestamp(), by: user.uid });
      tx.update(studentRef, {
        [kind === 'staff' ? 'staffNumber' : 'admissionNumber']: body.number,
        numberChosenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      });
      return { kind, old };
    });

    if (!result.unchanged) {
      waitUntil(tryWriteAudit({
        action: 'student.number_set', actor: user.uid, actorRole: user.role, target: `${session}/${phone}`,
        before: { number: result.old ? formatNumber(result.old.kind, result.old.digits) : null },
        after: { number: formatNumber(result.kind, body.number) },
        context: { requestId: log.requestId, device: user.device },
      }, log));
    }
    return { ok: true, kind: result.kind, number: body.number, display: formatNumber(result.kind, body.number) };
  },
});
