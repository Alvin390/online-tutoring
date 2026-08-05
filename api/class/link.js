import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, notFound } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { tryWriteAudit, AuditAction } from '../_lib/audit.js';

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
  method: 'POST',
  rateLimit: {
    bucket: 'class_link',
    limit: 20,
    windowSeconds: 3600,
    keyBy: 'ip',
  },
  schema,
  handle: async ({ body, req, log }) => {
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

    // --- Gate 1: subscription. Checked before anything student-specific, so a
    // locked deployment never issues a link to anyone. The student-facing
    // wording never says the teacher did not pay — that would damage the
    // teacher in front of their own customers.
    if (await isEnabled('billing.enabled')) {
      const subSnap = await db.doc('subscription/current').get();
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
      const snap = await db.doc(`sessions/${session}/students/${phone}`).get();
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
      if (await isEnabled('registration.requireApproval')) {
        const approval = data.approvalStatus ?? 'pending';
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
    const linkSnap = await db.doc('config/zoomLinks').get();
    const links = linkSnap.exists ? linkSnap.data() : {};
    const url = links[session];

    if (!url) {
      throw notFound('The class link has not been set up yet. Please contact your teacher.');
    }

    log.info('Class link issued', { session, staff: isStaff });

    // Not awaited into the response path — a slow audit write must not delay a
    // student joining a class that is already running.
    tryWriteAudit(
      {
        action: AuditAction.CLASS_LINK_ISSUED,
        actor: isStaff ? 'staff' : 'student',
        target: `${session}/${phone}`,
        context: { requestId: log.requestId },
      },
      log
    );

    return {
      url,
      provider: detectProvider(url),
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
