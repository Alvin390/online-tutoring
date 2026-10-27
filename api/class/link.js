import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';
import { assertSessionExists } from '../_lib/sessions.js';
import { effectiveApprovalStatus } from '../_lib/studentState.js';
import { passBypass } from '../_lib/checkinPass.js';

/**
 * Class link issuance — Phase 01 D1, completing the lockdown of
 * `config/zoomLinks`.
 *
 * That document used to be `allow read: if true`, which made the live class
 * link public to anyone holding the project ID. Blocking a student did nothing
 * to stop them joining: the block only changed which React screen rendered, and
 * the link was one Firestore read away regardless.
 *
 * The link is now issued here, and only after the caller's state is checked
 * server-side. This is the enforcement point for every gate that has ever been
 * described as "blocking a student from class".
 *
 * Phase 04 adds the approval gate to the checks below; Phase 03 adds the
 * subscription lockout. Both are wired here already so the sequencing is
 * visible in one place.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  // Phase 13 / 02 D6: every session slug in the body must exist.
  sessions: 'any',
  method: 'POST',
  // 002Fixes / 06: 20 → 120 an hour, matching check-in. Every student behind
  // one carrier NAT or family router shares this budget, and each is a caller
  // who has already passed check-in.
  rateLimit: {
    bucket: 'class_link',
    limit: 120,
    windowSeconds: 3600,
    keyBy: 'ip',
    // 002Fixes / 07: a valid check-in pass skips the count — never the
    // entitlement checks below, which run on every request.
    bypass: passBypass,
  },
  schema,
  handle: async ({ body, req, log, waitUntil }) => {
    const { session, phone } = body;

    let authorized = false;
    let isStaff = false;
    try {
      const user = await authenticate(req);
      if (user.role === 'student' && user.phone === phone) authorized = true;
      if (user.role === 'teacher' || user.role === 'superadmin') {
        authorized = true;
        isStaff = true;
      }
    } catch {
      // Fall through to the legacy path.
    }

    if (!authorized && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    const db = getDb();

    // Phase 13 / 08 C4: everything this request needs comes back in ONE
    // batchGet — subscription, student, class link — instead of three
    // sequential round trips. The gates below still run in the same order
    // with the same answers; the link is only ever returned if all pass.
    const [billingOn, sessionError, requireApproval] = await Promise.all([
      isEnabled('billing.enabled'),
      // Captured, not thrown: a locked subscription must still be reported
      // first (gate 1), exactly as when these ran one after another.
      isStaff ? null : assertSessionExists(db, session, { requireActive: true }).then(() => null, (err) => err),
      isStaff ? false : isEnabled('registration.requireApproval'),
    ]);
    const refs = {
      subscription: billingOn ? db.doc('subscription/current') : null,
      student: isStaff ? null : db.doc(`sessions/${session}/students/${phone}`),
      link: db.doc(`sessions/${session}/private/classLink`),
    };
    const wanted = Object.entries(refs).filter(([, ref]) => ref);
    const snaps = Object.fromEntries(
      (await db.getAll(...wanted.map(([, ref]) => ref))).map((snap, i) => [wanted[i][0], snap])
    );

    // --- Gate 1: subscription. Checked before anything student-specific, so a
    // locked deployment never issues a link to anyone. The student-facing
    // wording never says the teacher did not pay — that would damage the
    // teacher in front of their own customers.
    if (billingOn) {
      const subSnap = snaps.subscription;
      const status = subSnap.exists ? subSnap.data().status : null;
      if (status === 'locked' || status === 'expired') {
        throw forbidden(
          'Classes are temporarily unavailable. Please contact your teacher.',
          'service_unavailable'
        );
      }
    }

    // --- Gate 2: the student's own state.
    if (!isStaff) {
      // createHandler checked the session exists ('any', so staff can preview
      // a hidden session). Students also need it to be shown — cached, and
      // checked above alongside the flags.
      if (sessionError) throw sessionError;
      const snap = snaps.student;
      if (!snap.exists) throw notFound('No registration found for that number.');

      const data = snap.data();

      if (data.blocked === true) {
        throw forbidden(
          data.blockReason || 'Your access is currently on hold. Please contact your teacher.',
          'blocked'
        );
      }

      // Phase 04 turns this on. Until then the flag is off and the behaviour is
      // unchanged, but the check lives here rather than in the page component
      // so that enabling approval is a flag flip, not a re-architecture.
      if (requireApproval) {
        // Phase 13 / 03 D3: missing means approved (pre-approval registrations).
        const approval = effectiveApprovalStatus(data);
        if (approval !== 'approved') {
          throw forbidden(
            approval === 'rejected'
              ? (data.rejectionReason || 'Your registration was not approved.')
              : 'Your registration is with your teacher for approval.',
            approval === 'rejected' ? 'registration_rejected' : 'approval_pending'
          );
        }
      }
    }

    // --- Issue.
    //
    // Phase 05 moved the link to sessions/{slug}/private/classLink, which is
    // staff-only. It deliberately does NOT live on the session document: that
    // one is world-readable so an unauthenticated student can render the page,
    // and putting the link there would recreate the leak Phase 01 closed.
    //
    // config/zoomLinks is read as a shim for deployments that have not run
    // `npm run seed:sessions` yet. Removal criterion: sessions.teacherDefined
    // has been on for 14 days with no reads recorded against this fallback.
    let url = null;
    let provider = null;

    const privateSnap = snaps.link;
    if (privateSnap.exists) {
      url = privateSnap.data().url ?? null;
      provider = privateSnap.data().provider ?? null;
    }

    if (!url) {
      const legacySnap = await db.doc('config/zoomLinks').get();
      url = legacySnap.exists ? (legacySnap.data()[session] ?? null) : null;
      if (url) log.warn('legacy_link_fallback: class link served from config/zoomLinks', { session });
    }

    if (!url) {
      throw notFound('The class link has not been set up yet. Please contact your teacher.');
    }

    log.info('Class link issued', { session, staff: isStaff });

    // Not awaited into the response path — a slow audit write must not delay a
    // student joining a class that is already running.
    waitUntil(tryWriteAudit(
      {
        action: AuditAction.CLASS_LINK_ISSUED,
        actor: isStaff ? 'staff' : 'student',
        target: `${session}/${phone}`,
        context: { requestId: log.requestId },
      },
      log
    ));

    return {
      url,
      provider: provider ?? detectProvider(url),
      session,
    };
  },
});

/**
 * Provider detection by exact hostname, never by substring.
 *
 * The old client check was `zoomLink.includes('zoom.us')`, which passes for
 * `https://evil.com/?x=zoom.us`. Since the result of this call is fed to a
 * navigation, that was an open redirect. Phase 04 moves this into a shared
 * `parseClassLink` used by the teacher's input, this handler and the rules.
 */
function detectProvider(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return 'unknown';
    if (/^([a-z0-9-]+\.)?zoom\.us$/i.test(hostname)) return 'zoom';
    if (/^meet\.google\.com$/i.test(hostname)) return 'meet';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
