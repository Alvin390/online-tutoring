import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema, studentNameSchema } from '../_lib/validate.js';
import { ApiError } from '../_lib/errors.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';
import { projectStudent } from '../_lib/studentProjection.js';
import { issuePass } from '../_lib/checkinPass.js';
import { sessionClasses } from '../_lib/sessions.js';
import { subjectsForClass, checkSubjectChoice, MAX_SUBJECTS, MAX_SUBJECT_NAME, MAX_SUBJECTS_TEXT } from '../_lib/subjects.js';

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
  })
  .strict();

export default createHandler({
  // The session must exist and be shown to students (rules: isOpenSession).
  sessions: 'active',
  method: 'POST',
  schema,
  rateLimit: { bucket: 'student_register', limit: 10, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, log }) => {
    const { session, phone } = body;

    // Per number as well as per IP: the IP limit is spoofable behind a proxy.
    await enforceRateLimit({ key: phone, bucket: 'student_register_phone', limit: 5, windowSeconds: 3600 });

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);

    // The class must be one this session offers (the teacher edits the list
    // per session). A session with no document yet offers the defaults.
    const sessionSnap = await db.doc(`sessions/${session}`).get();
    const sessionDoc = sessionSnap.exists ? sessionSnap.data() : null;
    const offered = sessionClasses(sessionDoc);
    if (!offered.includes(body.class)) {
      throw new ApiError(400, 'invalid_class', 'Please choose a class from the list.');
    }
    const subjects = checkSubjectChoice(subjectsForClass(sessionDoc, body.class), body.subjects, body.class);
    if (!subjects.ok) throw new ApiError(400, 'invalid_subjects', subjects.message);
    if (subjects.text.length > MAX_SUBJECTS_TEXT) throw new ApiError(400, 'invalid_subjects', 'Too many subjects.');

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
    };

    try {
      await ref.create(student);
    } catch (err) {
      if (err?.code === 6 || err?.code === 'already-exists') {
        throw new ApiError(409, 'already_registered', 'That number is already registered for this class.');
      }
      throw err;
    }

    // The same number registering again after being deleted: the fee account
    // (closed at zero on deletion) belongs to a live student once more.
    const account = db.doc(`fees/accounts/items/${phone}`);
    const accountSnap = await account.get();
    if (accountSnap.exists && accountSnap.data().studentDeletedAt) {
      await account.set({
        session,
        studentDeletedAt: FieldValue.delete(),
        studentDeletedBy: FieldValue.delete(),
        status: FieldValue.delete(),
      }, { merge: true });
    }

    log.info('Student registered', { session });
    // 002Fixes / 07: a new student usually goes straight to the waiting
    // screen; its "Check again" and automatic checks carry this pass.
    const pass = issuePass({ session, phone });
    return {
      ok: true,
      student: projectStudent({ ...student, registeredAt: { toDate: () => new Date() } }),
      ...(pass ? { pass } : {}),
    };
  },
});
