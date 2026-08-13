import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { buildIcs } from '../_lib/ics.js';
import { sha256, randomToken } from '../_lib/crypto.js';
import { isEnabled } from '../_lib/flags.js';

/**
 * `.ics` export and subscription feed — Phase 07 D5.
 *
 * Two forms:
 *   - a one-off download (teacher, authenticated normally)
 *   - a SUBSCRIPTION URL carrying an opaque per-student token, so the student's
 *     calendar app stays in sync automatically
 *
 * The subscription form cannot use a bearer token: calendar clients fetch a
 * bare URL with no Authorization header and no cookies. So the credential is
 * the URL itself, which shapes the design:
 *
 *   - the token is random and opaque, never derived from the phone number
 *   - only its SHA-256 is stored, so a database read does not yield working
 *     feed URLs
 *   - it is READ-ONLY and scoped to one student's visible events
 *   - it is REVOCABLE, and a revoked token returns 401
 *
 * Not createHandler: this returns `text/calendar`, not JSON, and the
 * subscription form is deliberately unauthenticated in the usual sense.
 */

export default async function handler(req, res) {
  const requestId = randomUUID();
  const log = createLogger(requestId);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  // While the feature is off the endpoint 404s rather than serving stale data
  // to calendar apps that are still polling it.
  if (!(await isEnabled('calendar.enabled'))) {
    return res.status(404).json({ error: { code: 'not_found' } });
  }

  const token = String(req.query?.token ?? '');
  if (!token) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'A feed token is required.' } });
  }

  const db = getDb();
  const tokenSnap = await db.doc(`calendar/tokens/items/${sha256(token)}`).get();

  if (!tokenSnap.exists) {
    log.warn('Calendar feed requested with an unknown token');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  const tokenData = tokenSnap.data();

  if (tokenData.revokedAt) {
    log.warn('Calendar feed requested with a revoked token');
    return res.status(401).json({ error: { code: 'revoked' } });
  }

  // Subscription clients poll frequently; recording every hit would write more
  // than it is worth. A coarse daily stamp is enough to spot dead feeds.
  const today = new Date().toISOString().slice(0, 10);
  if (tokenData.lastAccessedDay !== today) {
    db.doc(`calendar/tokens/items/${sha256(token)}`)
      .set({ lastAccessedDay: today, lastAccessedAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => {});
  }

  const scope = tokenData.session ?? null;
  const isStaffFeed = tokenData.role === 'teacher';

  const snapshot = await db.collection('calendar/events/items').get();

  const events = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((event) => {
      if (isStaffFeed) return true;
      const sessionIds = event.sessionIds ?? [];
      return sessionIds.length === 0 || sessionIds.includes(scope);
    })
    .map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      start: event.start?.toDate?.() ?? null,
      end: event.end?.toDate?.() ?? null,
      recurrence: event.recurrence
        ? { ...event.recurrence, until: event.recurrence.until?.toDate?.() ?? null }
        : null,
      recurrenceExceptions: (event.recurrenceExceptions ?? []).map((v) => v?.toDate?.() ?? v),
    }));

  const ics = buildIcs({
    events,
    calendarName: isStaffFeed ? 'Class Calendar' : `Class Calendar — ${scope ?? 'all'}`,
    domain: process.env.PUBLIC_BASE_URL?.replace(/^https?:\/\//, '') || 'online-tutoring',
  });

  log.info('Calendar feed served', { events: events.length, staff: isStaffFeed });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="class-calendar.ics"');
  // Calendar apps poll aggressively; an hour of cache is plenty and keeps the
  // function invocation count sane.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).send(ics);
}

/** Mints a feed token. Exported for the token-management endpoint. */
export async function issueFeedToken(db, { role, session, phone, issuedBy }) {
  const token = randomToken(24);

  await db.doc(`calendar/tokens/items/${sha256(token)}`).set({
    role,
    session: session ?? null,
    phone: phone ?? null,
    issuedBy,
    issuedAt: FieldValue.serverTimestamp(),
    revokedAt: null,
    lastAccessedDay: null,
  });

  // Returned once, here. Only the hash is stored, so it cannot be recovered
  // later — a lost feed URL is reissued, not looked up.
  return token;
}
