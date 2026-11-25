import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema, studentNameSchema } from '../_lib/validate.js';
import { ApiError } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { projectStudent } from '../_lib/studentProjection.js';
import { issuePass } from '../_lib/checkinPass.js';
import { sessionClasses } from '../_lib/sessions.js';
import { subjectsForClass, checkSubjectChoice, MAX_SUBJECTS, MAX_SUBJECT_NAME, MAX_SUBJECTS_TEXT } from '../_lib/subjects.js';
import { isDuplicatePair, retiredMessage } from '../_lib/duplicates.js';
import { accountRef } from '../_lib/ledger.js';
import { getFlags } from '../_lib/flags.js';
import { verifyTicket, TICKET_LIFETIME_SECONDS } from '../_lib/verifyTicket.js';
import { recordNumber, formatNumber } from '../_lib/admissionNumber.js';
import { reserveGivenNumber } from '../_lib/assignNumber.js';
import { sendNumberSms } from '../_lib/numberSms.js';
import { schoolPlan } from '../_lib/schoolPlan.js';

/**
 * Student registration — Phase 13 / 08 A1.
 *
 * Registration was the ONE reason a student's browser needed the Firestore
 * SDK (~130 KB gz on every public page): it was a direct client `setDoc`,
 * guarded only by firestore.rules. Moving it here lets the public routes ship
 * no Firebase at all, and validates on the server as well (items 262, 327).
 *
 * Mirrors `isValidStudentCreate` in firestore.rules field for field, plus the
 * stricter name pattern the form already enforces. The rules' open-create
 * path stays until Phase 13 / 09, for clients cached from before this change.
 *
 * Returns the same projection as /api/student/checkin, so the page no longer
 * needs a second request to read the new record back.
 */

const text = (min, max) => z.string().trim().min(min).max(max);

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    studentName: studentNameSchema,
    class: text(1, 60),
    // Phase 14: the checked subjects (an array), or free text for a class
    // without a subject list. Stored as comma-separated text either way.
    subjects: z.union([
      text(3, MAX_SUBJECTS_TEXT),
      z.array(text(1, MAX_SUBJECT_NAME)).min(1).max(MAX_SUBJECTS),
    ]),
    receiptMessage: text(10, 500),
    // 008Fixes / 03: the number a student chose. 014Fixes / 02: numbers are
    // GIVEN now; only an old page still sends one (it is told to reload).
    number: z.string().trim().max(8).optional(),
    // 009Fixes / 01: the verified-phone ticket (code-first registration).
    ticket: z.string().max(80).optional(),
  })
  .strict();

export default createHandler({
  // The session must exist and be shown to students (rules: isOpenSession).
  sessions: 'active',
  method: 'POST',
  schema,
  // 008Fixes / 03: 10 → 30 an hour — new students behind one carrier address.
  // The per-number limit below stays the bound.
  rateLimit: { bucket: 'student_register', limit: 30, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log, waitUntil }) => {
    const { session, phone } = body;

    // 009Fixes / 01: with admission numbers on, code-first: the phone is
    // confirmed before the record is saved, so a number that can't receive a
    // code can't register. 014Fixes / 02 (owner, 2026-11-24): the school
    // GIVES the number when the record is saved; this switch alone decides.
    const flags = await getFlags();
    const numbersOn = flags['checkin.admissionNumbers'] === true;
    if (numbersOn) {
      const outOfDate = 'This page is out of date. Close it, then open the class link again and register.';
      // A page that still lets students choose a number, or one from before code-first.
      if (body.number) throw new ApiError(409, 'refresh_needed', outOfDate);
      if (!body.ticket) throw new ApiError(400, 'refresh_needed', outOfDate);
      if (!verifyTicket(body.ticket, { session, phone })) {
        throw new ApiError(403, 'verify_first', 'Confirm your phone number first: we will send you a code.');
      }
    }

    // Per number as well as per IP: the IP limit is spoofable behind a proxy.
    await enforceRateLimit({ key: phone, bucket: 'student_register_phone', limit: 5, windowSeconds: 3600 });

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);

    // The class must be one this session offers (the teacher edits the list
    // per session). A session with no document yet offers the defaults.
    // 003Fixes / 12: a number the teacher declined or merged is refused, with
    // what to do instead — read alongside the session, no extra request.
    const [sessionSnap, retiredSnap] = await db.getAll(
      db.doc(`sessions/${session}`), db.doc(`sessions/${session}/retiredNumbers/${phone}`),
    );
    if (retiredSnap.exists) {
      const retired = retiredSnap.data();
      throw new ApiError(409, 'retired_number', retiredMessage(retired.reason, retired.keptSuffix));
    }
    const sessionDoc = sessionSnap.exists ? sessionSnap.data() : null;
    const offered = sessionClasses(sessionDoc);
    if (!offered.includes(body.class)) {
      throw new ApiError(400, 'invalid_class', 'Please choose a class from the list.');
    }
    const subjects = checkSubjectChoice(subjectsForClass(sessionDoc, body.class), body.subjects, body.class);
    if (!subjects.ok) throw new ApiError(400, 'invalid_subjects', subjects.message);
    if (subjects.text.length > MAX_SUBJECTS_TEXT) throw new ApiError(400, 'invalid_subjects', 'Too many subjects.');

    // 003Fixes / 11: the same student registering again under another number
    // (same name and class, plus the same receipt or a near-identical number)
    // is accepted but HELD for the teacher. One query, on registration only;
    // the student is never told who the other record is.
    const sameClass = await db.collection(`sessions/${session}/students`).where('class', '==', body.class).get();
    const candidate = { parentPhone: phone, studentName: body.studentName, class: body.class, receiptMessage: body.receiptMessage };
    // 014Fixes / 02: never this phone's own record (a retried registration).
    const original = sameClass.docs
      .filter((doc) => doc.id !== phone)
      .map((doc) => ({ ...doc.data(), parentPhone: doc.data().parentPhone ?? doc.id }))
      .find((other) => isDuplicatePair(candidate, other));

    // Mandated initial state — identical to the rules: never blocked, never
    // pre-approved, no receipt approved, no balance.
    const student = {
      studentName: body.studentName,
      parentPhone: phone,
      class: body.class,
      subjects: subjects.text,
      receiptMessage: body.receiptMessage,
      registeredAt: FieldValue.serverTimestamp(),
      session,
      blocked: false,
      approvalStatus: 'pending',
      receiptStatus: 'pending',
      feeBalance: 0,
      ...(original ? { duplicateHold: true, duplicateOf: original.parentPhone } : {}),
      ...(numbersOn ? { phoneVerifiedAt: FieldValue.serverTimestamp() } : {}),
    };

    const alreadyRegistered = () => new ApiError(409, 'already_registered', 'That number is already registered for this class.');
    let given = null;
    if (numbersOn) {
      // 014Fixes / 02: the record and its GIVEN number in ONE transaction, so
      // nothing is half-made. Safe to retry: the same phone, confirmed by a
      // ticket, within the ticket's lifetime of the number being given, gets
      // the same answer instead of "already registered" (a lost answer).
      given = await db.runTransaction(async (tx) => {
        const mine = await tx.get(ref);
        if (mine.exists) {
          const saved = mine.data();
          const held = recordNumber(saved);
          const givenMs = saved.numberGivenAt?.toMillis?.() ?? 0;
          if (held && givenMs && Date.now() - givenMs <= TICKET_LIFETIME_SECONDS * 1000) {
            return { kind: held.kind, digits: held.digits, again: true, saved };
          }
          throw alreadyRegistered();
        }
        const digits = await reserveGivenNumber(tx, db, { session, phone, kind: 'student' });
        tx.create(ref, { ...student, admissionNumber: digits, numberGivenAt: FieldValue.serverTimestamp() });
        return { kind: 'student', digits, again: false };
      });
    } else {
      try {
        await ref.create(student);
      } catch (err) {
        if (err?.code === 6 || err?.code === 'already-exists') throw alreadyRegistered();
        throw err;
      }
    }

    // The same number registering again after being deleted: the fee account
    // (closed at zero on deletion) belongs to a live student once more.
    // 004Fixes / 06: this session's account only. (A retry did this already.)
    const account = accountRef(db, session, phone);
    const accountSnap = given?.again ? null : await account.get();
    if (accountSnap?.exists && accountSnap.data().studentDeletedAt) {
      await account.set({
        session,
        studentDeletedAt: FieldValue.delete(),
        studentDeletedBy: FieldValue.delete(),
        status: FieldValue.delete(),
      }, { merge: true });
    }

    if (given && !given.again) {
      // 014Fixes / 01: the number by SMS, once — after the answer.
      waitUntil(sendNumberSms({ db, session, phone, log }));
    }
    const shown = given?.again ? given.saved : { ...student, registeredAt: { toDate: () => new Date() } };
    const heldFor = given?.again ? given.saved.duplicateHold === true : Boolean(original);
    log.info('Student registered', { session, held: heldFor, ...(given?.again ? { retried: true } : {}) });
    // 002Fixes / 07: a new student usually goes straight to the waiting
    // screen; its "Check again" and automatic checks carry this pass.
    // 008Fixes / 03: with admission numbers, the phone is confirmed next
    // (the pass comes with the first full check-in).
    const pass = numbersOn ? null : issuePass({ session, phone });
    return {
      ok: true,
      // 009Fixes / 01: code-first records are already confirmed - check in next.
      // 014Fixes / 02: with the number the school gave (the pop-up shows it).
      ...(numbersOn ? { next: 'checkin', number: { kind: given.kind, digits: given.digits, display: formatNumber(given.kind, given.digits) } } : {}),
      ...(heldFor ? { held: 'duplicate' } : {}),
      student: projectStudent(
        shown,
        // 013Fixes / 05: fee status only on a plan with fees.
        { fees: await schoolPlan(db).then((p) => p.features.fees === true, () => false) }
      ),
      ...(pass ? { pass } : {}),
    };
  },
});
