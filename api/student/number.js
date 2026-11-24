import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { ApiError, forbidden, notFound } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { verifyTicket, TICKET_LIFETIME_SECONDS } from '../_lib/verifyTicket.js';
import { getFlags } from '../_lib/flags.js';
import { reserveGivenNumber } from '../_lib/assignNumber.js';
import {
  numberProblem, numberProblemMessage, recordNumber, reservationId, formatNumber,
} from '../_lib/admissionNumber.js';

/**
 * Choosing an admission or staff number — 008Fixes / 02.
 *
 *   check   is this number free? "free" | "taken" | "easy" | "format". ONE
 *           document read, and nothing about who holds it. Open (the
 *           registration form checks live, before any code), limited per address.
 *   assign  014Fixes / 00 (owner, 2026-11-24): numbers are GIVEN, not chosen.
 *           Needs the verified-phone ticket from verifyCode, so knowing a phone
 *           number is not enough. A record WITHOUT a number gets a random free
 *           one (api/_lib/assignNumber.js); staff get a staff number (S-xxxx).
 *           Safe to retry: a number given within the ticket's lifetime comes
 *           back again (a lost answer on a flaky phone). Any other number is
 *           the teacher's ("ask your teacher"; POST /api/students/admission).
 *   choose  retired with 014Fixes: old copies of the page are told to reload.
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
    action: z.literal('assign'),
    session: sessionSchema,
    phone: phoneSchema,
    ticket: z.string().max(80),
  }).strict(),
  // 014Fixes / 00: only old pages send this; they are told to reload.
  z.object({ action: z.literal('choose') }).passthrough(),
]);

const PAGE_OUT_OF_DATE = 'This page is out of date. Close it, then open the class link again and check in.';
const ALREADY_HAS_NUMBER = 'You already have an admission number for this class. Ask your teacher for it.';

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

    if (body.action === 'choose') throw new ApiError(410, 'refresh_needed', PAGE_OUT_OF_DATE);

    // assign
    const flags = await getFlags();
    if (flags['checkin.admissionNumbers'] !== true) throw new ApiError(409, 'refresh_needed', PAGE_OUT_OF_DATE);
    const { phone } = body;
    if (!verifyTicket(body.ticket, { session, phone })) {
      throw forbidden('Please confirm your phone number again.', 'verification_required');
    }
    await enforceRateLimit({ key: phone, bucket: 'student_number_phone', limit: 30, windowSeconds: 3600 });

    const studentRef = db.doc(`sessions/${session}/students/${phone}`);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(studentRef);
      if (!snap.exists) throw notFound('No registration found for that number.');
      const data = snap.data();
      const held = recordNumber(data);
      if (held) {
        const givenMs = data.numberGivenAt?.toMillis?.() ?? 0;
        if (givenMs && Date.now() - givenMs <= TICKET_LIFETIME_SECONDS * 1000) {
          return { kind: held.kind, digits: held.digits, again: true };
        }
        throw new ApiError(409, 'already_has_number', ALREADY_HAS_NUMBER);
      }
      const kind = data.staff === true ? 'staff' : 'student';
      const digits = await reserveGivenNumber(tx, db, { session, phone, kind });
      tx.update(studentRef, {
        [kind === 'staff' ? 'staffNumber' : 'admissionNumber']: digits,
        numberGivenAt: FieldValue.serverTimestamp(),
      });
      return { kind, digits, again: false };
    });

    if (!result.again) {
      waitUntil(tryWriteAudit({
        action: 'student.number_given', actor: 'student', target: `${session}/${phone}`,
        after: { kind: result.kind }, context: { requestId: log.requestId },
      }, log));
      log.info('Number given', { session, kind: result.kind });
    }
    return { ok: true, kind: result.kind, number: result.digits, display: formatNumber(result.kind, result.digits) };
  },
});
