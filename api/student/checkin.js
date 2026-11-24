import { createHandler } from '../_lib/handler.js';
import { projectStudent } from '../_lib/studentProjection.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { ApiError, badRequest, forbidden } from '../_lib/errors.js';
import { getFlags } from '../_lib/flags.js';
import { clientIp } from '../_lib/rateLimit.js';
import { effectiveApprovalStatus, isBlockedNow } from '../_lib/studentState.js';
import { issuePass, passBypass } from '../_lib/checkinPass.js';
import { parseNumberInput, recordNumber, reservationId } from '../_lib/admissionNumber.js';
import { DEVICE_ID_PATTERN, lockRef, deviceHash, lockState, lockUntil } from '../_lib/checkinLock.js';
import { sessionSchedule } from '../_lib/sessions.js';
import { cachedPlan, planRefs, rememberPlan } from '../_lib/schoolPlan.js';

/**
 * Student check-in — Phase 01 D1/D4.
 *
 * This endpoint exists because `allow read: if true` is gone. A student has no
 * credential a Firestore rule could evaluate, so their own record is served
 * here instead, by the Admin SDK, one document at a time.
 *
 * The two properties that matter:
 *
 *   1. It returns EXACTLY ONE document, ever. There is no list form and no
 *      query parameter that could produce one. Enumerating the roster is not
 *      possible through this endpoint at any rate limit.
 *
 *   2. It returns a PROJECTION, not the document. The receipt text, the block
 *      reason's internal notes and every server-owned field stay on the server.
 *      A student sees only what their own screen needs to render.
 *
 * Authorization is layered, strongest first:
 *   - A verified student token bound to this phone (Phase 02), OR
 *   - the `auth.legacyStudentRead` flag, for students who registered before
 *     phone verification existed.
 *
 * The legacy path is knowingly weaker: it authenticates nothing, so knowing a
 * phone number is enough to see that phone's own registration status. It is
 * rate-limited hard and returns a minimal projection. Its removal criterion is
 * in flags.js.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    // 008Fixes / 03: the admission number ("0042") or staff number ("S-0042"),
    // and this browser's device id. New pages always send the device id.
    number: z.string().trim().max(12).optional(),
    deviceId: z.string().regex(DEVICE_ID_PATTERN).optional(),
  })
  .strict();

/**
 * 008Fixes / 03 — the refusals of an admission-number check-in. 409 for a
 * step the page leads the student through, 403 for a refusal. Every message
 * is written for the student: an old cached page shows `message` as it is.
 */
export const CHECKIN_STEP = Object.freeze({
  REFRESH: 'refresh_needed',
  VERIFY: 'verify_required',
  CHOOSE: 'choose_number',
  NUMBER: 'number_required',
  MISMATCH: 'number_mismatch',
  DUPLICATE: 'duplicate_records',
  OTHER_DEVICE: 'other_device',
});
const step = (code, message) => new ApiError(409, code, message);
const MISMATCH_MESSAGE = "That admission number and phone don't match. Check both, or ask your teacher.";
// 014Fixes / 03 (copy.md §2a): what to do now, not just what happened.
const OTHER_DEVICE_MESSAGE = 'Your number is already checked in on another device for this class. You can use this device next class, or ask your teacher to allow this one now.';

/**
 * 008Fixes / 03: with `checkin.admissionNumbers` on, who may come in. Returns
 * the lock to write ({ until }) or null. Throws the step or refusal otherwise.
 * Order (plan): verified → has a number → number given → it matches → the
 * reservation agrees → no other device holds this class.
 */
function admissionGate({ data, phone, number, reservation, lock, hash }) {
  if (!data.phoneVerifiedAt) {
    throw step(CHECKIN_STEP.VERIFY, 'Confirm your phone number first: we will send you a code. If you do not see where to enter it, refresh the page.');
  }
  const held = recordNumber(data);
  if (!held) {
    throw step(CHECKIN_STEP.CHOOSE, data.staff === true
      ? 'Choose your staff number to continue.'
      : 'Choose your admission number to continue.');
  }
  if (!number) throw step(CHECKIN_STEP.NUMBER, 'Enter your admission number too.');
  // The same message whichever of the two is wrong: it never says which.
  if (number.kind !== held.kind || number.digits !== held.digits) {
    throw forbidden(MISMATCH_MESSAGE, CHECKIN_STEP.MISMATCH);
  }
  // The reservation is what makes a number unique. If it names another
  // number, two records claim this one — the teacher sorts it out.
  if (!reservation || reservation.phone !== phone) {
    throw step(CHECKIN_STEP.DUPLICATE, 'Your teacher needs to sort out duplicate records. Please try again later.');
  }
  const state = lockState(lock, hash);
  if (state === 'other') {
    throw forbidden(
      OTHER_DEVICE_MESSAGE,
      CHECKIN_STEP.OTHER_DEVICE,
    );
  }
  return state === 'same' ? null : { write: state === 'none' ? 'create' : 'set' };
}

/** Heartbeat granularity: "last seen" does not need to be finer than this. */
export const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;


export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist and be shown to students.
  sessions: 'active',
  method: 'POST',
  // 002Fixes / 06: 30 → 120 an hour. Everyone behind one carrier NAT or family
  // router shares this budget; at class time one address sent 34 check-ins in
  // an hour on 26 Oct. Probing many numbers stays bounded at 120 an hour.
  rateLimit: {
    bucket: 'student_checkin',
    limit: 120,
    windowSeconds: 3600,
    keyBy: 'ip',
    // 002Fixes / 07: a valid check-in pass skips this (and the phone limit).
    bypass: passBypass,
  },
  schema,
  handle: async ({ body, req, log, waitUntil }) => {
    const { session, phone, deviceId } = body;

    // Strongest available authorization first.
    let authorized = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === phone) authorized = true;
      else if (user.role === 'teacher' || user.role === 'superadmin') authorized = true;
    } catch {
      // No token, or an invalid one. Fall through to the legacy path.
    }

    // ONE flags read for both (parallel reads of a cold cache would each go
    // to Firestore — a check-in's cost is guarded by a test).
    const flags = await getFlags();
    const numbersOn = flags['checkin.admissionNumbers'] === true;
    if (!authorized && flags['auth.legacyStudentRead'] !== true) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    // 008Fixes / 03: a page from before admission numbers sends no device id.
    // It is told to refresh (an old page shows the message as it is).
    let number = null;
    if (numbersOn) {
      if (!deviceId) {
        // 010Fixes / 05: words a student can act on (old pages show them as they are).
        throw step(CHECKIN_STEP.REFRESH, 'This page is out of date. Close it, then open the class link again and check in.');
      }
      if (body.number) {
        number = parseNumberInput(body.number);
        if (!number) {
          throw badRequest('Enter your 4-digit admission number (staff: S- and 4 digits).', 'invalid_number');
        }
      }
    }

    // A second limiter keyed on the phone itself. The IP limit above is
    // spoofable behind a proxy; this one bounds how hard any single number can
    // be probed regardless of where the requests appear to come from.
    //
    // Phase 13 / 08 C4: it runs IN PARALLEL with the reads, and the student
    // document and its activity marker come back in ONE batchGet — one Google
    // round trip after the IP limiter instead of four. Nothing is returned
    // until the limiter has passed, so a limited caller still learns nothing.
    //
    // 002Fixes / 06: 20 per TEN MINUTES, not per hour. The same burst cap, but
    // a refusal now lasts minutes: on 26 Oct three waiting students were
    // locked out until the top of the hour, one until 80 minutes into class.
    const phoneLimit = authorized || req.passAccepted === true
      ? Promise.resolve()
      : import('../_lib/rateLimit.js').then(({ enforceRateLimit }) => enforceRateLimit({
        key: phone,
        bucket: 'student_checkin_phone',
        limit: 20,
        windowSeconds: 600,
      }));

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);
    const activityRef = db.doc(`sessions/${session}/students/${phone}/meta/activity`);
    // 003Fixes / 12: a number the teacher declined or merged, in the same batchGet.
    const retiredRef = db.doc(`sessions/${session}/retiredNumbers/${phone}`);
    // 008Fixes / 03: the number's reservation and this class's lock come back
    // in the SAME batchGet — still one round trip.
    const extraRefs = numbersOn
      ? [lockRef(db, session, phone), ...(number ? [db.doc(`sessions/${session}/numbers/${reservationId(number.kind, number.digits)}`)] : [])]
      : [];
    // 013Fixes / 05: the school's plan (does it include fees?) rides in the
    // same batchGet when it isn't cached — no extra round trip, ever.
    const knownPlan = cachedPlan();
    const planDocs = knownPlan ? [] : planRefs(db);
    const [all] = await Promise.all([
      db.getAll(ref, activityRef, retiredRef, ...planDocs, ...extraRefs),
      phoneLimit,
    ]);
    const [snap, activity, retiredSnap] = all;
    const plan = knownPlan ?? rememberPlan(all[3], all[4]);
    const [lockSnap, reservationSnap] = all.slice(3 + planDocs.length);

    if (!snap.exists) {
      // Deliberately identical in shape to the found case — no timing or
      // wording difference that would confirm whether a number is registered.
      // A RETIRED number is told what to do instead (owner decision): only
      // why, and for a merge the kept number's last 3 digits.
      const retired = retiredSnap?.exists ? retiredSnap.data() : null;
      if (retired) {
        return {
          exists: false,
          student: null,
          retired: retired.reason === 'merged' ? 'merged' : 'duplicate',
          ...(retired.reason === 'merged' && retired.keptSuffix ? { keptSuffix: retired.keptSuffix } : {}),
        };
      }
      return { exists: false, student: null };
    }

    const data = snap.data();

    // 008Fixes / 03: admission number + phone, one device per class. The lock
    // is written on the response path (create-if-absent), so two devices
    // racing cannot both win.
    if (numbersOn) {
      const hash = deviceHash(session, phone, deviceId);
      const lock = admissionGate({
        data,
        phone,
        number,
        reservation: reservationSnap?.exists ? reservationSnap.data() : null,
        lock: lockSnap?.exists ? lockSnap.data() : null,
        hash,
      });
      if (lock) {
        const until = new Date(lockUntil(await sessionSchedule(db, session)));
        const lockDoc = { deviceHash: hash, until, at: FieldValue.serverTimestamp() };
        try {
          if (lock.write === 'create') await lockRef(db, session, phone).create(lockDoc);
          else await lockRef(db, session, phone).set(lockDoc);
        } catch (err) {
          if (err?.code !== 6 && err?.code !== 'already-exists') throw err;
          // Another device got there a moment first.
          const raced = (await lockRef(db, session, phone).get()).data();
          if (lockState(raced, hash) !== 'same') {
            throw forbidden(
              OTHER_DEVICE_MESSAGE,
              CHECKIN_STEP.OTHER_DEVICE,
            );
          }
        }
      }
    }

    // Heartbeat — Phase 13 / 08 B3. Written to a SEPARATE document
    // (meta/activity), not the student document: every teacher dashboard
    // listens to the student documents, so each visit used to push the whole
    // row to every open dashboard. And at most once per 10 minutes per
    // student, judged from the marker read above. In waitUntil, so it never
    // delays the response; skipped while blocked, as before.
    const lastMs = activity.exists ? activity.data().lastAccessed?.toMillis?.() ?? 0 : 0;
    if (!isBlockedNow(data) && Date.now() - lastMs >= HEARTBEAT_INTERVAL_MS) {
      waitUntil(
        activityRef.set({ lastAccessed: FieldValue.serverTimestamp() }, { merge: true }).catch((err) => {
          log.warn('lastAccessed update failed', { code: err?.code });
        })
      );
    }

    log.info('Student check-in', {
      session,
      blocked: isBlockedNow(data),
      approvalStatus: effectiveApprovalStatus(data),
      ip: clientIp(req),
    });

    // 002Fixes / 07: a pass for this number's repeat checks. Only when the
    // student exists — an unknown number gets nothing to skip limits with.
    const pass = issuePass({ session, phone });
    // 013Fixes / 05: the balance only on a plan with fees.
    return { exists: true, student: projectStudent(data, { fees: plan.features.fees === true }), ...(pass ? { pass } : {}) };
  },
});
