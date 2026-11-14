import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { ApiError, badRequest, forbidden, notFound } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { verifyTicket } from '../_lib/verifyTicket.js';
import {
  numberProblem, numberProblemMessage, recordNumber, reservationId, formatNumber,
} from '../_lib/admissionNumber.js';

/**
 * Choosing an admission or staff number — 008Fixes / 02.
 *
 *   check   is this number free? "free" | "taken" | "easy" | "format". ONE
 *           document read, and nothing about who holds it. Open (the
 *           registration form checks live, before any code), limited per address.
 *   choose  take it. Needs the verified-phone ticket from verifyCode, so
 *           knowing a phone number is not enough to choose for that student.
 *           Only a record WITHOUT a number may choose; changing a number is the
 *           teacher's (POST /api/students/admission). Staff records get a staff
 *           number (S-xxxx), everyone else an admission number.
 *
 * Uniqueness is Firestore's: the reservation `sessions/{s}/numbers/{A0042|S0042}`
 * is CREATED in the same transaction that sets the number on the record, and a
 * create fails if the document exists — two students can never hold one
 * number, even at the same instant. Per session (owner answer 5).
 */

const digits = z.string().trim().max(8);

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('check'),
    session: sessionSchema,
    number: digits,
    kind: z.enum(['student', 'staff']).optional(),
  }).strict(),
  z.object({
    action: z.literal('choose'),
    session: sessionSchema,
    phone: phoneSchema,
    number: digits,
    ticket: z.string().max(80),
  }).strict(),
]);

export default createHandler({
  sessions: 'active',
  method: 'POST',
  schema,
  // Typing is debounced (400 ms) on the page; a class behind one address fits.
  rateLimit: { bucket: 'student_number', limit: 600, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log, waitUntil }) => {
    const db = getDb();
    const { session } = body;

    if (body.action === 'check') {
      const kind = body.kind ?? 'student';
      const problem = numberProblem(body.number);
      if (problem) return { status: problem, message: numberProblemMessage(problem) };
      const snap = await db.doc(`sessions/${session}/numbers/${reservationId(kind, body.number)}`).get();
      return snap.exists
        ? { status: 'taken', message: 'That number is taken. Choose another.' }
        : { status: 'free', message: 'Available' };
    }

    // choose
    const { phone } = body;
    if (!verifyTicket(body.ticket, { session, phone })) {
      throw forbidden('Please confirm your phone number again.', 'verification_required');
    }
    await enforceRateLimit({ key: phone, bucket: 'student_number_phone', limit: 30, windowSeconds: 3600 });
    const problem = numberProblem(body.number);
    if (problem) throw badRequest(numberProblemMessage(problem), problem === 'easy' ? 'easy_number' : 'invalid_number');

    const studentRef = db.doc(`sessions/${session}/students/${phone}`);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) throw notFound('No registration found for that number.');
      const data = snap.data();
      if (recordNumber(data)) {
        throw new ApiError(409, 'already_has_number', 'You already have a number. Ask your teacher if you need to change it.');
      }
      const kind = data.staff === true ? 'staff' : 'student';
      const reservation = db.doc(`sessions/${session}/numbers/${reservationId(kind, body.number)}`);
      const taken = await tx.get(reservation);
      if (taken.exists) throw new ApiError(409, 'number_taken', 'That number is taken. Choose another.');
      tx.create(reservation, { phone, kind, number: body.number, at: FieldValue.serverTimestamp() });
      tx.update(studentRef, {
        [kind === 'staff' ? 'staffNumber' : 'admissionNumber']: body.number,
        numberChosenAt: FieldValue.serverTimestamp(),
      });
      return { kind };
    });

    waitUntil(tryWriteAudit({
      action: 'student.number_chosen', actor: 'student', target: `${session}/${phone}`,
      after: { kind: result.kind }, context: { requestId: log.requestId },
    }, log));
    log.info('Number chosen', { session, kind: result.kind });
    return { ok: true, kind: result.kind, number: body.number, display: formatNumber(result.kind, body.number) };
  },
});
