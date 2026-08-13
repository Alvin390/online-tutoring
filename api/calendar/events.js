import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, sessionSchema, phoneSchema } from '../_lib/validate.js';
import { authenticate } from '../_lib/auth.js';
import { forbidden, badRequest } from '../_lib/errors.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * Calendar event reads — Phase 07 D4.
 *
 * One endpoint serving both audiences, with the scoping decided server-side:
 *
 *   teacher  → every event
 *   student  → only events scoped to their session, plus global ones
 *
 * A student must never be able to widen that scope by asking. The session comes
 * from their own registration record, not from the request body — otherwise
 * "show me Grade 8's schedule" would be a query parameter away.
 *
 * THE WINDOW IS CAPPED AT 90 DAYS. Recurrence is expanded from a rule, so an
 * unbounded window is an invitation to ask for ten years and burn CPU
 * generating half a million occurrences.
 */

const MAX_WINDOW_DAYS = 90;

const schema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    session: sessionSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  schema,
  rateLimit: { bucket: 'calendar_events', limit: 120, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, req, log }) => {
    if (!(await isEnabled('calendar.enabled'))) {
      return { calendarEnabled: false, events: [] };
    }

    const from = new Date(body.from);
    const to = new Date(body.to);

    if (to <= from) throw badRequest('The end of the window must be after the start.');

    const windowDays = (to - from) / (24 * 60 * 60 * 1000);
    if (windowDays > MAX_WINDOW_DAYS) {
      throw badRequest(
        `Ask for at most ${MAX_WINDOW_DAYS} days at a time.`,
        'window_too_large'
      );
    }

    const db = getDb();

    // ---- Who is asking, and what may they see?
    let isStaff = false;
    let studentSession = null;

    try {
      const user = await authenticate(req);
      if (user.role === 'teacher' || user.role === 'superadmin') isStaff = true;
      else if (user.role === 'student' && user.phone) {
        const found = await findStudentSession(db, user.phone, body.session);
        studentSession = found?.session ?? null;
      }
    } catch {
      // Unverified student on the legacy path.
    }

    if (!isStaff && !studentSession) {
      if (!(await isEnabled('auth.legacyStudentRead'))) {
        throw forbidden('Please verify your phone number to continue.', 'verification_required');
      }
      if (!body.session || !body.phone) {
        throw badRequest('A session and phone number are required.');
      }

      const found = await findStudentSession(db, body.phone, body.session);
      if (!found) throw forbidden('No registration found for that number.', 'not_registered');

      // Students only see the calendar once the teacher has approved them.
      if ((found.data.approvalStatus ?? 'approved') !== 'approved') {
        throw forbidden('Your registration is still awaiting approval.', 'approval_pending');
      }

      studentSession = found.session;
    }

    // ---- Subscription gate. A locked deployment shows students nothing,
    // with wording that never blames the teacher.
    if (!isStaff && (await isEnabled('billing.enabled'))) {
      const sub = await db.doc('subscription/current').get();
      const status = sub.exists ? sub.data().status : null;
      if (status === 'locked' || status === 'expired') {
        throw forbidden(
          'The class calendar is temporarily unavailable. Please contact your teacher.',
          'service_unavailable'
        );
      }
    }

    // ---- Query.
    //
    // Bounded by `start <= to`, and recurring series are fetched separately
    // because a weekly rule that began last year still produces occurrences in
    // this window — filtering on `start >= from` would hide exactly the events
    // the calendar exists to show.
    const collection = db.collection('calendar/events/items');

    const [singles, recurring] = await Promise.all([
      collection.where('start', '>=', from).where('start', '<=', to).get(),
      collection.where('isRecurring', '==', true).get(),
    ]);

    const byId = new Map();
    for (const doc of [...singles.docs, ...recurring.docs]) {
      byId.set(doc.id, { id: doc.id, ...doc.data() });
    }

    const events = [...byId.values()]
      .filter((event) => {
        if (isStaff) return true;
        const scope = event.sessionIds ?? [];
        // An empty array means "everyone".
        return scope.length === 0 || scope.includes(studentSession);
      })
      .map((event) => ({
        id: event.id,
        title: event.title,
        description: isStaff ? (event.description ?? null) : (event.description ?? null),
        start: event.start?.toDate?.()?.toISOString() ?? null,
        end: event.end?.toDate?.()?.toISOString() ?? null,
        allDay: event.allDay === true,
        colour: event.colour ?? '#667eea',
        sessionIds: event.sessionIds ?? [],
        recurrence: event.recurrence
          ? {
              ...event.recurrence,
              until: event.recurrence.until?.toDate?.()?.toISOString() ?? event.recurrence.until ?? null,
            }
          : null,
        recurrenceExceptions: (event.recurrenceExceptions ?? []).map(
          (value) => value?.toDate?.()?.toISOString() ?? value
        ),
      }));

    log.debug('Calendar events served', { count: events.length, staff: isStaff });

    return { calendarEnabled: true, events, scope: isStaff ? 'all' : studentSession };
  },
});

/** Finds a student across sessions, preferring a hinted one. */
async function findStudentSession(db, phone, hint) {
  const candidates = hint ? [hint] : [];

  const sessionsSnap = await db.collection('sessions').get();
  for (const sessionDoc of sessionsSnap.docs) {
    if (!candidates.includes(sessionDoc.id)) candidates.push(sessionDoc.id);
  }
  if (candidates.length === 0) candidates.push('morning', 'evening');

  for (const session of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await db.doc(`sessions/${session}/students/${phone}`).get();
    if (snap.exists) return { session, data: snap.data() };
  }
  return null;
}

export { MAX_WINDOW_DAYS };
