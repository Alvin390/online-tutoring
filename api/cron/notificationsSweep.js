import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb, getStorage } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { subrequestsRemaining, SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { gmailConfigured, getGmailAccessToken, GmailError } from '../_lib/gmail.js';
import { MAX_EMAIL_ATTEMPTS, sendReportEmail } from '../_lib/reports.js';

/**
 * Report email retries, Gmail keep-alive, orphan screenshot purge —
 * Phase 13 / 06 D4.
 *
 * Shares the ten-minute trigger with mpesaReconcile (which runs first: money
 * before mail), so it works inside whatever subrequest budget is left and
 * stops early rather than being killed part-way.
 *
 *   1. RETRY  reports whose email is pending (older than two minutes, so the
 *             submit's own waitUntil send is not raced) or failed-and-due.
 *             At most five per run.
 *   2. KEEP-ALIVE  once a week, exchange the Gmail refresh token. Google
 *             expires one unused for six months, and a quiet half-year
 *             without a report is plausible here. An `invalid_grant` turns the
 *             superadmin card red before any report is affected.
 *   3. PURGE  screenshots uploaded for a report that was never submitted,
 *             after 24 hours. `reportUploads/{id}` only exists until submit.
 */

const MAX_SENDS = 5;
const PENDING_GRACE_MS = 2 * 60 * 1000;
const KEEPALIVE_MS = 7 * 24 * 60 * 60 * 1000;
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_PURGES = 5;

// Firestore calls are counted by the shim; Gmail's two fetches are not, so
// they are included here by hand. One email ≈ 5 Firestore + 2 Google.
const COST_PER_SEND = 8;
const COST_PER_PURGE = 6;
const RESERVE = 2;

const hasBudget = (cost) => subrequestsRemaining() >= cost + RESERVE;
const millis = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : null);

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const explicit = req.headers['x-cron-secret'];
  return (
    (bearer != null && safeCompare(bearer, secret))
    || (typeof explicit === 'string' && safeCompare(explicit, secret))
  );
}

/** Which reports are due a (re)send — exported for tests. */
export function isDue(report, now) {
  const email = report.email ?? {};
  if (email.status !== 'pending' && email.status !== 'failed') return false;
  if ((email.attempts ?? 0) >= MAX_EMAIL_ATTEMPTS) return false;
  if (email.status === 'failed') {
    const next = millis(email.nextAttemptAt);
    return next != null && next <= now; // null = not retryable (needs a human)
  }
  const created = millis(report.createdAt) ?? 0;
  const next = millis(email.nextAttemptAt);
  return now - created >= PENDING_GRACE_MS && (next == null || next <= now);
}

async function retryEmails(db, now, log, result) {
  if (!hasBudget(COST_PER_SEND + 1)) return;
  const snap = await db
    .collection('reports')
    .where('email.status', 'in', ['pending', 'failed'])
    .limit(25)
    .get();

  const due = snap.docs
    .filter((d) => isDue(d.data(), now))
    .sort((a, b) => (millis(a.data().createdAt) ?? 0) - (millis(b.data().createdAt) ?? 0))
    .slice(0, MAX_SENDS);

  for (const doc of due) {
    if (!hasBudget(COST_PER_SEND)) { result.deferred += 1; continue; }
    const outcome = await sendReportEmail(db, doc.id, { log });
    if (outcome.sent) result.sent += 1;
    else result.failed += 1;
  }
}

async function keepGmailAlive(db, now, log, result) {
  if (!gmailConfigured() || !hasBudget(4)) return;
  const ref = db.doc('config/notifications');
  const settings = (await ref.get()).data() ?? {};
  const last = millis(settings.gmail?.lastTokenCheckAt);
  if (last != null && now - last < KEEPALIVE_MS) return;

  try {
    await getGmailAccessToken({ force: true });
    await ref.set({ gmail: { lastTokenCheckAt: new Date(now), disconnected: false } }, { merge: true });
    result.tokenChecked = 'ok';
  } catch (err) {
    const code = err instanceof GmailError ? err.code : 'unknown';
    await ref.set(
      { gmail: { lastTokenCheckAt: new Date(now), lastError: err.message, lastErrorAt: new Date(now),
        disconnected: code === 'invalid_grant' || code === 'not_configured' } },
      { merge: true }
    );
    log.warn('Gmail keep-alive failed', { code });
    result.tokenChecked = code;
  }
}

async function purgeOrphans(db, now, log, result) {
  if (!hasBudget(COST_PER_PURGE + 1)) return;
  const snap = await db
    .collection('reportUploads')
    .where('createdAt', '<', new Date(now - ORPHAN_AFTER_MS))
    .limit(MAX_PURGES)
    .get();

  const bucket = getStorage().bucket();
  for (const doc of snap.docs) {
    if (!hasBudget(COST_PER_PURGE)) break;
    const paths = Object.values(doc.data().files ?? {})
      .flatMap((f) => [f?.fullPath, f?.thumbPath])
      .filter(Boolean);
    // delete() treats 404 as success: already gone is the outcome we wanted.
    for (const path of paths) await bucket.file(path).delete();
    await doc.ref.delete();
    result.purged += 1;
  }
  if (result.purged) log.info('Orphan report screenshots purged', { reports: result.purged });
}

export default async function handler(req, res) {
  const log = createLogger(randomUUID());
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!authorized(req)) {
    log.warn('Unauthorized notifications sweep invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  const db = getDb();
  const now = Date.now();
  const result = { sent: 0, failed: 0, deferred: 0, purged: 0, tokenChecked: null };

  // Each step is independent: one failing must not starve the others.
  for (const [name, step] of [['retry', retryEmails], ['keepalive', keepGmailAlive], ['purge', purgeOrphans]]) {
    try {
      await step(db, now, log, result);
    } catch (err) {
      if (err instanceof SubrequestBudgetExceeded) {
        log.warn('Notifications sweep ran out of budget', { step: name });
        break;
      }
      log.error(`Notifications sweep step failed: ${name}`, err);
      result[`${name}Error`] = String(err?.message ?? err).slice(0, 200);
    }
  }

  return res.status(200).json({ ok: true, ...result });
}
