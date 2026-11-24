import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { z, phoneSchema, sessionSchema, otpCodeSchema } from '../_lib/validate.js';
import { sha256, safeCompare } from '../_lib/crypto.js';
import { ApiError, badRequest } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { getFlags } from '../_lib/flags.js';
import { issueTicket, verifyTicket } from '../_lib/verifyTicket.js';
import { recordNumber } from '../_lib/admissionNumber.js';
import { retiredMessage, sameStudentName } from '../_lib/duplicates.js';
import { issueCode, tooManyCodes, tooManyTries, CODES_PER_HOUR } from '../_lib/otpIssue.js';
import { moveStudent } from '../_lib/moveStudent.js';

/**
 * Fix my number — 009Fixes / 02 (owner, 2026-11-16).
 *
 * Before admission numbers (live 15 Nov) phones were never confirmed, and
 * some students registered with a fake or mistyped number: they can never
 * receive the confirmation code. Once, and only for a record that was NEVER
 * confirmed, the student moves it to their real number:
 *
 *   request  { session, newPhone, oldPhone }            the number they registered with
 *            { session, newPhone, studentName, class }  or, forgotten: their name and class
 *            → finds the record, sends a code to the REAL number
 *   confirm  the same, plus `code`
 *            → the whole record moves to the real number (approval, fees and
 *              ledger, notes, admission number) and is CONFIRMED; then the
 *              usual "choose your admission number" with the ticket returned
 *   confirm  { session, newPhone, ticket }  resumes a move that ran out of
 *            budget (`partial: true`), from the new record's marker
 *
 * By name and class: the ONE never-confirmed record in that class with the
 * same name (decorative fonts, case and word order ignored; at least two
 * words). None or several: the same "not found" as a wrong number — the
 * server never reveals names. A confirmed record (including one already
 * fixed) is refused: changing it is the teacher's (owner: once only).
 * Behind `checkin.admissionNumbers` (014Fixes / 05: that switch alone; the
 * check-in code step offers it as "That phone isn't near me"). The move is the
 * teacher edit's (api/_lib/moveStudent.js); the code is requestCode's
 * (api/_lib/otpIssue.js), with its limits and the teacher's "Codes waiting".
 */

const name = z.string().trim().min(3).max(80);
const className = z.string().trim().min(1).max(60);
const who = { oldPhone: phoneSchema.optional(), studentName: name.optional(), class: className.optional() };

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), session: sessionSchema, newPhone: phoneSchema, ...who }).strict(),
  z.object({
    action: z.literal('confirm'), session: sessionSchema, newPhone: phoneSchema, ...who,
    code: otpCodeSchema.optional(), ticket: z.string().max(80).optional(),
  }).strict(),
]);

const RECORD_TRIES_PER_HOUR = 5;
const notFoundError = () => new ApiError(404, 'not_found', "We couldn't find you. Check the details, or ask your teacher.");
const invalidCode = () => badRequest('That code is not valid or has expired.', 'invalid_code');

/** The record this student means: by the number they registered with, or by name and class. */
async function findRecord(db, session, body) {
  if (body.oldPhone) {
    const snap = await db.doc(`sessions/${session}/students/${body.oldPhone}`).get();
    if (!snap.exists) throw notFoundError();
    return { phone: snap.id, data: snap.data() };
  }
  if (!body.studentName || !body.class) {
    throw badRequest('Enter the number you registered with, or your name and class.', 'details_required');
  }
  const snap = await db.collection(`sessions/${session}/students`).where('class', '==', body.class).get();
  const matches = snap.docs.filter((d) => {
    const data = d.data();
    return !data.phoneVerifiedAt && !data.numberFixedAt && data.moveInProgress !== true
      && sameStudentName(body.studentName, data.studentName);
  });
  if (matches.length !== 1) throw notFoundError();
  return { phone: matches[0].id, data: matches[0].data() };
}

/** Only a never-confirmed record, not mid-move, moving to a number that is new here. */
async function checkMove(db, session, found, newPhone) {
  if (found.data.phoneVerifiedAt) {
    throw new ApiError(409, 'already_confirmed', 'This number is already confirmed. To change it, ask your teacher.');
  }
  // Once only (owner): the teacher's own phone edit clears "confirmed" but
  // keeps this marker, so a record she later moved can't be moved again here.
  if (found.data.numberFixedAt) {
    throw new ApiError(409, 'already_fixed', 'Your number has already been changed once. To change it again, ask your teacher.');
  }
  if (found.data.moveInProgress === true) {
    throw new ApiError(409, 'move_in_progress', 'Your record is being moved. Please try again in a minute.');
  }
  if (found.phone === newPhone) {
    throw badRequest('That is the number you registered with. Enter your real number.', 'same_number');
  }
  const [target, retired] = await db.getAll(
    db.doc(`sessions/${session}/students/${newPhone}`),
    db.doc(`sessions/${session}/retiredNumbers/${newPhone}`),
  );
  if (target.exists) {
    throw new ApiError(409, 'number_in_use', 'That number is already registered for another student in this class. Ask your teacher.');
  }
  if (retired.exists) {
    const r = retired.data();
    throw new ApiError(409, 'retired_number', retiredMessage(r.reason, r.keptSuffix));
  }
}

/** The answer after a finished move: a ticket for the real number, and the next step. */
async function finished(db, session, newPhone) {
  const snap = await db.doc(`sessions/${session}/students/${newPhone}`).get();
  const record = snap.data() ?? {};
  return {
    ok: true,
    phone: newPhone,
    ticket: issueTicket({ session, phone: newPhone }),
    // 014Fixes / 00: given, not chosen.
    next: recordNumber(record) ? 'checkin' : 'assignNumber',
    numberKind: record.staff === true ? 'staff' : 'student',
  };
}

const STUDENT = { uid: 'student', role: 'student' };

export default createHandler({
  sessions: 'active',
  method: 'POST',
  schema,
  rateLimit: { bucket: 'fix_number_ip', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log, waitUntil }) => {
    const flags = await getFlags();
    // 014Fixes / 05: one switch — admission numbers alone (not student.fixNumber).
    if (flags['checkin.admissionNumbers'] !== true) {
      throw new ApiError(404, 'not_available', 'This is not available.');
    }
    const { session, newPhone } = body;
    const db = getDb();
    const otpRef = db.collection('otp').doc(sha256(newPhone));

    // ---------------------------------------------------------- resume
    if (body.action === 'confirm' && body.ticket && !body.code) {
      if (!verifyTicket(body.ticket, { session, phone: newPhone })) {
        throw new ApiError(403, 'verify_first', 'Please confirm your number again.');
      }
      const snap = await db.doc(`sessions/${session}/students/${newPhone}`).get();
      if (!snap.exists || !snap.data().numberFixedFrom) throw notFoundError();
      if (snap.data().moveInProgress === true) {
        try {
          await moveStudent({
            db, session, oldPhone: snap.data().movedFrom, newPhone, user: STUDENT, log,
            auditAction: 'student.number_fixed_by_student',
          });
        } catch (err) {
          if (err instanceof SubrequestBudgetExceeded) return { ok: true, partial: true, ticket: issueTicket({ session, phone: newPhone }) };
          throw err;
        }
      }
      return finished(db, session, newPhone);
    }

    const found = await findRecord(db, session, body);
    await checkMove(db, session, found, newPhone);

    // ---------------------------------------------------------- request
    if (body.action === 'request') {
      const [otpSnap] = await Promise.all([
        otpRef.get(),
        // Five tries an hour for one record, and the usual SMS cost bound on
        // the real number (shared with requestCode).
        enforceRateLimit({ key: `${session}:${found.phone}`, bucket: 'fix_number_record', limit: RECORD_TRIES_PER_HOUR, windowSeconds: 3600 }),
        enforceRateLimit({ key: newPhone, bucket: 'otp_request_phone', limit: CODES_PER_HOUR, windowSeconds: 3600 })
          .catch((err) => { throw err?.status === 429 ? tooManyCodes(err.retryAfter) : err; }),
      ]);
      return issueCode({
        otpRef, otpSnap, session, phone: newPhone, purpose: 'move', extra: { fromPhone: found.phone }, log, waitUntil,
      });
    }

    // ---------------------------------------------------------- confirm
    if (!body.code) throw invalidCode();
    const verified = await db.runTransaction(async (tx) => {
      const snap = await tx.get(otpRef);
      if (!snap.exists) return { ok: false };
      const data = snap.data();
      const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
      if (data.consumedAt || expiresAt < Date.now()) return { ok: false };
      if ((data.attempts ?? 0) >= (data.maxAttempts ?? 5)) return { ok: false, locked: true };
      // A move code, for this session, this record and this real number only.
      if (data.purpose !== 'move' || data.session !== session || data.phone !== newPhone || data.fromPhone !== found.phone) {
        return { ok: false };
      }
      if (!safeCompare(sha256(`${newPhone}:${body.code}`), data.codeHash)) {
        tx.update(otpRef, { attempts: FieldValue.increment(1) });
        return { ok: false };
      }
      tx.update(otpRef, { consumedAt: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1) });
      return { ok: true };
    });
    if (!verified.ok) throw verified.locked ? tooManyTries() : invalidCode();

    try {
      await moveStudent({
        db, session, oldPhone: found.phone, newPhone, user: STUDENT, log,
        extra: {
          phoneVerifiedAt: FieldValue.serverTimestamp(),
          numberFixedAt: FieldValue.serverTimestamp(),
          numberFixedFrom: found.phone,
        },
        auditAction: 'student.number_fixed_by_student',
      });
    } catch (err) {
      if (err instanceof SubrequestBudgetExceeded) {
        log.warn('Number fix stopped at the subrequest budget; resumable', { session });
        return { ok: true, partial: true, ticket: issueTicket({ session, phone: newPhone }) };
      }
      throw err;
    }
    log.info('Student fixed their number', { session, by: body.oldPhone ? 'number' : 'name' });
    return finished(db, session, newPhone);
  },
});
