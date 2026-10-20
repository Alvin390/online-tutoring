import { parseClassLink } from './classLink.js';
import { notFound, badRequest } from './errors.js';
import { tryWriteAudit, AuditAction } from './audit.js';
import { invalidateBootstrap } from './publicBootstrap.js';

/**
 * Session slug rules — server copy. Phase 05 Part A.
 *
 * Duplicated from src/shared/constants/sessions.js for the usual reason: `/api`
 * is a separate build target. A parity test asserts the two lists agree, so a
 * slug reserved in the UI cannot be accepted by the API.
 */

export const RESERVED_SLUGS = Object.freeze([
  'login', 'logout', 'dashboard', 'billing', 'superadmin', 'admin',
  '403', '404',
  'api', 'assets', 'static', 'sw', 'workbox', 'manifest', 'robots', 'favicon',
  'fees', 'calendar', 'whatsapp', 'settings', 'account', 'help',
  // Phase 13 / 06 routes.
  'reports', 'support',
]);

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function validateSlug(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'Please enter a web address for this session.' };
  }

  const slug = raw.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      error:
        'Use 1–40 lowercase letters, numbers and hyphens. It cannot start or end with a hyphen.',
    };
  }

  if (RESERVED_SLUGS.includes(slug)) {
    return { valid: false, error: `"${slug}" is reserved by the app. Please choose another.` };
  }

  return { valid: true, slug };
}

/**
 * Recursively deletes a document and everything beneath it.
 *
 * FIRESTORE DOES NOT CASCADE. Deleting `sessions/x/students/y` leaves
 * `sessions/x/students/y/notes/*` orphaned but fully intact — still readable by
 * anyone with the path, still counted in collection-group queries, and
 * invisible in the console because the parent is gone. For private teacher
 * notes about a student who has been removed, that is a data-protection problem
 * as well as a correctness one.
 *
 * `recursiveDelete` on the Admin SDK handles this; the loop below is the
 * fallback for environments where the bulk writer is unavailable.
 */
export async function deleteRecursively(db, ref) {
  // Phase 13 / 03 D2 — BATCHED, and deliberately NOT `db.recursiveDelete`:
  // the REST shim's version deletes one document per request, which is exactly
  // the subrequest cost this avoids. This used to delete one document per request
  // (and list each document's subcollections with another), so removing a
  // student with 600 notes needed ~1,200 subrequests against a budget of 45.
  // Now: one query per known subcollection, then deletes in commits of up to
  // 450 writes. Children are deleted before their parents.
  const refs = [];
  await collectTree(ref, refs);
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
  // Per collection id, so a caller can report "notes removed" without
  // counting other subcollections (meta/activity, Phase 13 / 08 B3).
  const byCollection = {};
  for (const r of refs) {
    const parts = r.path.split('/');
    const collectionId = parts[parts.length - 2];
    byCollection[collectionId] = (byCollection[collectionId] ?? 0) + 1;
  }
  return { deleted: refs.length, byCollection };
}

/**
 * The app's document tree, so a delete need not ask Firestore which
 * subcollections exist (one `listCollections` call per document). Keyed by the
 * id of the collection a document lives in. Anything not listed falls back to
 * `listCollections`.
 */
const KNOWN_SUBCOLLECTIONS = Object.freeze({
  sessions: ['students', 'private'],
  students: ['notes', 'meta'],
  notes: [],
  meta: [],
  private: [],
});

async function collectTree(ref, out) {
  const segments = ref.path.split('/');
  const parentCollection = segments[segments.length - 2];
  const known = KNOWN_SUBCOLLECTIONS[parentCollection];
  const subIds = known ?? (await ref.listCollections()).map((c) => c.id);

  for (const sub of subIds) {
    // eslint-disable-next-line no-await-in-loop
    const snap = await ref.collection(sub).get();
    for (const child of snap.docs) {
      // eslint-disable-next-line no-await-in-loop
      await collectTree(child.ref, out);
    }
  }
  out.push(ref);
}

// ---------------------------------------------------------------------------
// Default sessions — Phase 13 / 02 D1
// ---------------------------------------------------------------------------

export const SESSION_TZ = 'Africa/Nairobi';

/**
 * The classes a student can pick when registering for a session — editable by
 * the teacher per session. A session document without its own list (every
 * session created before this existed) offers these. Mirror of DEFAULT_CLASSES
 * in src/shared/constants/sessions.js (parity-tested).
 */
export const DEFAULT_CLASSES = Object.freeze(['Form One', 'Form Two', 'Form Three', 'Form Four']);
export const MAX_CLASSES = 30;
export const MAX_CLASS_NAME = 60;

/** The class list a session offers: its own, or the defaults. */
export function sessionClasses(sessionDoc) {
  const list = sessionDoc?.classes;
  return Array.isArray(list) && list.length > 0 ? list : [...DEFAULT_CLASSES];
}

/**
 * The two sessions every deployment starts with, pre-filled with EXACTLY what
 * the homepage showed before sessions became data, so the first bootstrap
 * changes nothing visually. Every field is editable afterwards.
 *
 * `days: []` means "every day": the old copy named no days, so none are
 * invented. Keep src/shared/constants/sessions.js DEFAULT_SESSIONS in step
 * (a parity test enforces it).
 */
export const DEFAULT_SESSIONS = Object.freeze([
  Object.freeze({
    slug: 'morning',
    name: 'Morning Session',
    description: 'Start your day with focused learning and interactive classes',
    schedule: Object.freeze({ days: [], startTime: '08:00', endTime: '12:00', tz: SESSION_TZ }),
    icon: 'bi-sunrise-fill',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    order: 0,
  }),
  Object.freeze({
    slug: 'evening',
    name: 'Evening Session',
    description: 'Perfect for after-school learning and homework support',
    schedule: Object.freeze({ days: [], startTime: '16:00', endTime: '20:00', tz: SESSION_TZ }),
    icon: 'bi-moon-stars-fill',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    order: 1,
  }),
]);

/**
 * TRANSITIONAL — removed in Phase 13 / 09 once production has bootstrapped.
 *
 * Production today has NO session documents: students reach /morning and
 * /evening on the legacy fallback. Until the bootstrap has run there, these two
 * slugs count as existing and active even without a document, exactly like the
 * matching clause in firestore.rules, so deploying this code cannot take the
 * two live classes offline.
 */
export const LEGACY_SLUGS = Object.freeze(['morning', 'evening']);

const isAlreadyExists = (err) => err?.code === 6 || err?.code === 'already-exists';

/**
 * Creates morning and evening, once per deployment, and migrates any legacy
 * links from config/zoomLinks into each session's private link document.
 *
 * RUN-ONCE, via the `config/sessionsBootstrap` marker, created with `create()`
 * so concurrent callers race safely: exactly one wins and does the work. That
 * marker is also what stops a teacher who DELETES "Evening" from getting it
 * back an hour later.
 *
 * Idempotent per document too: session docs and private links are written with
 * `create()`, so an existing document — including a link the teacher already
 * set — is never overwritten.
 *
 * Called from: the dashboard (sessions/manage `bootstrap`, when a teacher sees
 * an empty list), the hourly subscription sweep, and `npm run seed:sessions`.
 *
 * @returns {Promise<{ran: boolean, created: string[], migratedLinks: string[], skippedInvalidLinks: string[]}>}
 */
export async function ensureDefaultSessions(db, { actor = 'system', log } = {}) {
  const outcome = { ran: false, created: [], migratedLinks: [], skippedInvalidLinks: [] };

  try {
    await db.doc('config/sessionsBootstrap').create({ at: new Date(), by: actor });
  } catch (err) {
    if (isAlreadyExists(err)) return outcome;
    throw err;
  }
  outcome.ran = true;

  const legacySnap = await db.doc('config/zoomLinks').get();
  const legacy = legacySnap.exists ? legacySnap.data() : {};
  const now = new Date();

  for (const def of DEFAULT_SESSIONS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.doc(`sessions/${def.slug}`).create({
        name: def.name,
        slug: def.slug,
        description: def.description,
        schedule: { ...def.schedule, days: [...def.schedule.days] },
        icon: def.icon,
        gradient: def.gradient,
        order: def.order,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      outcome.created.push(def.slug);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }

    const legacyUrl = legacy[def.slug];
    if (!legacyUrl) continue;

    const parsed = parseClassLink(legacyUrl);
    if (!parsed.valid) {
      outcome.skippedInvalidLinks.push(def.slug);
      log?.warn?.('Legacy class link is invalid and was not migrated', { session: def.slug });
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await db.doc(`sessions/${def.slug}/private/classLink`).create({
        url: parsed.url,
        provider: parsed.provider,
        updatedAt: now,
        updatedBy: `migration:${actor}`,
      });
      outcome.migratedLinks.push(def.slug);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
  }

  __resetSessionCache();

  await tryWriteAudit(
    {
      action: 'sessions.bootstrapped',
      actor,
      target: 'sessions',
      after: {
        created: outcome.created,
        migratedLinks: outcome.migratedLinks,
        skippedInvalidLinks: outcome.skippedInvalidLinks,
      },
    },
    log
  );

  return outcome;
}

// ---------------------------------------------------------------------------
// One link store — Phase 13 / 02 D3
// ---------------------------------------------------------------------------

/**
 * Writes a session's class link. The ONLY place a link is written:
 * /api/class/setLink and sessions/manage `setLink` both call this, so there is
 * one store (`sessions/{slug}/private/classLink`) and students always receive
 * what the teacher last saved. `config/zoomLinks` is no longer written.
 */
export async function setSessionLink(db, slug, url, { actor, actorRole, log, requestId } = {}) {
  const parsed = parseClassLink(url);
  if (!parsed.valid) throw badRequest(parsed.error, 'invalid_class_link');

  await assertSessionExists(db, slug);

  const ref = db.doc(`sessions/${slug}/private/classLink`);
  const before = (await ref.get()).data() ?? null;

  await ref.set(
    {
      url: parsed.url,
      provider: parsed.provider,
      updatedAt: new Date(),
      updatedBy: actor ?? 'unknown',
    },
    { merge: true }
  );

  // The link is not a secret, but it is an access credential — the trail
  // records that it changed and to which provider, not the URL.
  await tryWriteAudit(
    {
      action: AuditAction.CLASS_LINK_UPDATED,
      actor,
      actorRole,
      target: `sessions/${slug}`,
      before: { provider: before?.provider ?? null, hadLink: Boolean(before?.url) },
      after: { provider: parsed.provider, hadLink: true },
      context: { requestId },
    },
    log
  );

  return { url: parsed.url, provider: parsed.provider };
}

// ---------------------------------------------------------------------------
// Session existence — Phase 13 / 02 D6
// ---------------------------------------------------------------------------

const SESSION_CACHE_TTL_MS = 60_000;
const SESSION_CACHE_MAX = 100;
const sessionCache = new Map(); // slug -> { exists, active, at }

export function __resetSessionCache() {
  sessionCache.clear();
}

/** Drops one slug, after a write that changes its existence or `active`. */
export function invalidateSession(slug) {
  invalidateBootstrap(); // the public session list (Phase 13 / 08 A1)
  sessionCache.delete(slug);
}

async function lookupSession(db, slug) {
  const hit = sessionCache.get(slug);
  if (hit && Date.now() - hit.at < SESSION_CACHE_TTL_MS) return hit;

  const snap = await db.doc(`sessions/${slug}`).get();
  let entry;
  if (snap.exists) {
    entry = { exists: true, active: snap.data().active !== false, at: Date.now() };
  } else if (LEGACY_SLUGS.includes(slug)) {
    entry = { exists: true, active: true, legacy: true, at: Date.now() };
  } else {
    entry = { exists: false, active: false, at: Date.now() };
  }

  if (sessionCache.size >= SESSION_CACHE_MAX) {
    sessionCache.delete(sessionCache.keys().next().value);
  }
  sessionCache.set(slug, entry);
  return entry;
}

/**
 * Throws 404 unless `sessions/{slug}` exists (and, with `requireActive`, is
 * shown to students). Cached per isolate for 60 s and 100 slugs, so a hot
 * endpoint pays for at most one extra read a minute per session.
 */
export async function assertSessionExists(db, slug, { requireActive = false } = {}) {
  const entry = await lookupSession(db, slug);
  if (!entry.exists || (requireActive && !entry.active)) {
    throw notFound('This class is not available.', 'session_not_found');
  }
  return entry;
}
