import { createHandler } from '../_lib/handler.js';
import { projectStudent } from '../_lib/studentProjection.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { clientIp } from '../_lib/rateLimit.js';
import { effectiveApprovalStatus, isBlockedNow } from '../_lib/studentState.js';
import { issuePass, passBypass } from '../_lib/checkinPass.js';

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
  })
  .strict();

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
    const { session, phone } = body;

    // Strongest available authorization first.
    let authorized = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === phone) authorized = true;
      else if (user.role === 'teacher' || user.role === 'superadmin') authorized = true;
    } catch {
      // No token, or an invalid one. Fall through to the legacy path.
    }

    if (!authorized && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
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
    const [[snap, activity]] = await Promise.all([db.getAll(ref, activityRef), phoneLimit]);

    if (!snap.exists) {
      // Deliberately identical in shape to the found case — no timing or
      // wording difference that would confirm whether a number is registered.
      return { exists: false, student: null };
    }

    const data = snap.data();

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
    return { exists: true, student: projectStudent(data), ...(pass ? { pass } : {}) };
  },
});
