import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';
import { accountRef, ledgerRef } from '../_lib/ledger.js';

/**
 * Student-facing fee summary — Phase 06 D9.
 *
 * Returns FOUR NUMBERS AND A DATE for the caller's own phone. The ledger itself
 * is never exposed to a student: they get a summary, not a queryable history.
 * A student who could list their own ledger could infer the teacher's whole
 * pricing structure, and could correlate entry timestamps with other students'.
 *
 * A teacher calling this for any student gets the same shape plus the recent
 * entries, so the drawer and the student screen share one endpoint rather than
 * drifting apart.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'fees_summary', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req, log }) => {
    const { session, phone } = body;

    if (!(await isEnabled('fees.enabled'))) {
      return { feesEnabled: false, summary: null };
    }

    let isStaff = false;
    let authorized = false;

    try {
      const user = await authenticate(req);
      if (user.role === 'teacher' || user.role === 'superadmin') {
        isStaff = true;
        authorized = true;
      } else if (user.role === 'student' && user.phone === phone) {
        authorized = true;
      }
    } catch {
      // Fall through to the legacy path.
    }

    if (!authorized && !(await isEnabled('auth.legacyStudentRead'))) {
      throw forbidden('Please verify your phone number to continue.', 'verification_required');
    }

    const db = getDb();
    const accountSnap = await accountRef(db, phone).get();
    const account = accountSnap.exists ? accountSnap.data() : null;

    const summary = {
      balance: account?.balance ?? 0,
      lastPaymentAt: account?.lastPaymentAt?.toDate?.()?.toISOString() ?? null,
      lastPaymentAmount: account?.lastPaymentAmount ?? null,
      nextDueDate: account?.nextDueDate?.toDate?.()?.toISOString() ?? null,
      status: account?.status ?? 'current',
    };

    // Statement entries are STAFF ONLY.
    let entries = null;
    if (isStaff) {
      const snap = await ledgerRef(db, phone).orderBy('occurredAt', 'desc').limit(50).get();
      entries = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        occurredAt: d.data().occurredAt?.toDate?.()?.toISOString() ?? null,
        recordedAt: d.data().recordedAt?.toDate?.()?.toISOString() ?? null,
      }));
    }

    log.debug('Fee summary served', { session, staff: isStaff });

    return { feesEnabled: true, summary, entries };
  },
});
