import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { clientIp } from '../_lib/rateLimit.js';

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

/** Only these fields ever cross the wire. Everything else stays server-side. */
function projectStudent(data) {
  return {
    studentName: data.studentName ?? null,
    class: data.class ?? null,
    subjects: data.subjects ?? null,
    session: data.session ?? null,
    // Explicit coercion: a legacy document written before Phase 01 has no
    // `blocked` field at all, and `undefined` is falsy — which is precisely the
    // bug that let unapproved registrations walk into class. Default to the
    // SAFE value, not the convenient one.
    blocked: data.blocked === true,
    blockReason: data.blocked === true ? (data.blockReason ?? '') : '',
    approvalStatus: data.approvalStatus ?? 'pending',
    rejectionReason: data.approvalStatus === 'rejected' ? (data.rejectionReason ?? '') : null,
    receiptStatus: data.receiptStatus ?? 'pending',
    hasPendingReceipt: Boolean(data.pendingReceipt),
    feeBalance: typeof data.feeBalance === 'number' ? data.feeBalance : 0,
    registeredAt: data.registeredAt?.toDate?.()?.toISOString() ?? null,
  };
}

export default createHandler({
  method: 'POST',
  rateLimit: {
    bucket: 'student_checkin',
    limit: 30,
    windowSeconds: 3600,
    keyBy: 'ip',
  },
  schema,
  handle: async ({ body, req, log }) => {
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
    if (!authorized) {
      const { enforceRateLimit } = await import('../_lib/rateLimit.js');
      await enforceRateLimit({
        key: phone,
        bucket: 'student_checkin_phone',
        limit: 20,
        windowSeconds: 3600,
      });
    }

    const db = getDb();
    const ref = db.doc(`sessions/${session}/students/${phone}`);
    const snap = await ref.get();

    if (!snap.exists) {
      // Deliberately identical in shape to the found case — no timing or
      // wording difference that would confirm whether a number is registered.
      return { exists: false, student: null };
    }

    const data = snap.data();

    // Heartbeat. Fire-and-forget: a failed timestamp write must not fail a
    // check-in. Skipped while blocked, matching the previous behaviour.
    if (data.blocked !== true) {
      ref.set({ lastAccessed: FieldValue.serverTimestamp() }, { merge: true }).catch((err) => {
        log.warn('lastAccessed update failed', { code: err?.code });
      });
    }

    log.info('Student check-in', {
      session,
      blocked: data.blocked === true,
      approvalStatus: data.approvalStatus ?? 'pending',
      ip: clientIp(req),
    });

    return { exists: true, student: projectStudent(data) };
  },
});
