import { getAdminAuth } from './firebaseAdmin.js';
import { gmailConfigured, sendGmail } from './gmail.js';
import { isEnabled } from './flags.js';
import { getNotificationSettings } from './reports.js';
import { nextClassWindow } from './classTime.js';
import { subrequestsRemaining } from './firestoreRest.js';

/**
 * Pre-class approval reminders — 002Fixes / 09.
 *
 * On 26 Oct students were approved during the evening class. The dashboard
 * banner (002Fixes / 08) helps when the dashboard is open; this emails the
 * teacher when it is not: 60 minutes before a class if anyone is waiting for
 * approval, and again at 15 minutes if anyone still is.
 *
 * Runs inside notificationsSweep (every 10 minutes), so each window is hit at
 * least once. A marker document per session, day and reminder makes it
 * at-most-once even when runs overlap. The email carries counts per class and
 * a dashboard link — never a name or a number — and says plainly that it is
 * automated and not to be replied to (owner requirement, 2026-10-27).
 *
 * Settings live beside the report recipient in `config/notifications`:
 *   classAlertsEnabled   false turns this off (absent = on)
 *   classAlertRecipient  where it goes (absent = the teacher's login email)
 * Both are changed in Superadmin → Notifications.
 */

export const MARKS = 'notificationMarks';
export const MARK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 3;
// A count query, a marker, a teacher lookup, and Gmail's token + send.
const COST_PER_SESSION = 7;
const RESERVE = 2;

export const NO_REPLY_NOTICE = 'This is an automated email from Online Tutoring. Please do not reply to it — replies are not read.';

/** Which reminder is due for a class starting at `start`: '60', '15' or null. */
export function dueReminder(start, now) {
  const minutes = (start - now) / 60_000;
  if (minutes <= 0) return null; // the class has started: the dashboard takes over
  if (minutes <= 15) return '15';
  if (minutes <= 60) return '60';
  return null;
}

/** '19:30' → '7:30 PM' (matches the class page). */
export function clockLabel(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The class's calendar date in its own zone — the marker's day. */
function classDay(start, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(start));
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The email. `counts` is [[className, n], …]. No student names or numbers.
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildPreclassEmail({ sessionName, startLabel, minutesLeft, counts, dashboardUrl, test = false }) {
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  const s = total === 1 ? '' : 's';
  const lead = `${total} student${s} ${total === 1 ? 'is' : 'are'} waiting for your approval for ${sessionName}, which starts at ${startLabel}${minutesLeft ? ` (in about ${minutesLeft} minutes)` : ''}.`;
  const subject = `${test ? '[Test] ' : ''}${total} student${s} waiting for approval — ${sessionName} at ${startLabel}`;
  const footer = 'You can change where these alerts go, or turn them off, in Superadmin → Notifications.';
  const text = [
    NO_REPLY_NOTICE,
    '',
    test ? 'This is a TEST of the before-class reminder. Nobody is actually waiting.\n' : null,
    lead,
    '',
    'Waiting by class:',
    ...counts.map(([cls, n]) => `  ${cls}: ${n}`),
    '',
    `Approve them on your dashboard: ${dashboardUrl}`,
    '',
    '—',
    NO_REPLY_NOTICE,
    footer,
  ].filter((line) => line !== null).join('\n');
  const html = `<p style="margin:0 0 16px;padding:8px 12px;background:#f3f4f6;color:#374151;border-radius:6px"><strong>${escapeHtml(NO_REPLY_NOTICE)}</strong></p>
${test ? '<p style="color:#b45309"><strong>This is a TEST of the before-class reminder. Nobody is actually waiting.</strong></p>\n' : ''}<p>${escapeHtml(lead)}</p>
<p style="margin-bottom:4px"><strong>Waiting by class:</strong></p>
<ul>${counts.map(([cls, n]) => `<li>${escapeHtml(cls)}: ${n}</li>`).join('')}</ul>
<p><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Open the dashboard</a></p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="color:#6b7280;font-size:13px">${escapeHtml(NO_REPLY_NOTICE)}<br>${escapeHtml(footer)}</p>`;
  return { subject, text, html };
}

/** The login emails of the teacher account(s) — the default recipient. */
async function teacherEmails() {
  const page = await getAdminAuth().listUsers(1000);
  return page.users
    .filter((u) => (u.customClaims ?? {}).role === 'teacher' && u.email && u.disabled !== true)
    .map((u) => u.email.toLowerCase())
    .slice(0, MAX_RECIPIENTS);
}

/**
 * Where class alerts go, and why — shared by the sweep and the superadmin card.
 * @returns {Promise<{ recipients: string[], source: 'set'|'teacher'|'report' }>}
 */
export async function classAlertRecipients(settings) {
  if (settings.classAlertRecipient) return { recipients: [settings.classAlertRecipient], source: 'set' };
  const teachers = await teacherEmails().catch(() => []);
  if (teachers.length) return { recipients: teachers, source: 'teacher' };
  return { recipients: [settings.reportRecipient].filter(Boolean), source: 'report' };
}

export const dashboardUrl = () => `${(process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')}/dashboard`;

/** Waiting students in one session, as [[className, n], …] sorted by class. */
async function waitingByClass(db, sessionId) {
  const snap = await db.collection(`sessions/${sessionId}/students`).where('approvalStatus', '==', 'pending').get();
  const counts = new Map();
  for (const doc of snap.docs) {
    const cls = String(doc.data().class ?? 'No class');
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Marker documents older than a week, a few per run. */
async function purgeMarks(db, now, result) {
  const old = await db.collection(MARKS).where('createdAt', '<', new Date(now - MARK_TTL_MS)).limit(5).get();
  for (const doc of old.docs) {
    await doc.ref.delete();
    result.preclassPurged = (result.preclassPurged ?? 0) + 1;
  }
}

/** The sweep step. Writes what it did into `result`. */
export async function sendPreclassReminders(db, now, log, result) {
  result.preclassSent = result.preclassSent ?? 0;
  if (!(await isEnabled('registration.requireApproval'))) return;
  if (!gmailConfigured()) {
    log.warn('Pre-class reminders skipped: Gmail is not configured');
    return;
  }
  const settings = await getNotificationSettings(db);
  if (settings.classAlertsEnabled === false) return;

  const sessions = (await db.collection('sessions').get()).docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((s) => s.active !== false);

  let recipients = null;
  for (const session of sessions) {
    const window = nextClassWindow(session.schedule, now);
    const key = window ? dueReminder(window.start, now) : null;
    if (!key) continue;

    if (subrequestsRemaining() < COST_PER_SESSION + RESERVE) {
      result.preclassDeferred = (result.preclassDeferred ?? 0) + 1;
      continue; // the next run, ten minutes later, tries again
    }

    const counts = await waitingByClass(db, session.id);
    if (counts.length === 0) continue; // nobody waiting: no email, no marker

    // At most once per session, day and reminder, even if runs overlap.
    const markRef = db.doc(`${MARKS}/preclass_${session.id}_${classDay(window.start, session.schedule?.tz)}_${key}`);
    try {
      await markRef.create({ session: session.id, reminder: key, createdAt: new Date(now) });
    } catch (err) {
      if (err?.code === 6 || err?.code === 'already-exists') continue;
      throw err;
    }

    recipients = recipients ?? (await classAlertRecipients(settings)).recipients;
    const email = buildPreclassEmail({
      sessionName: session.name ?? session.id,
      startLabel: clockLabel(session.schedule?.startTime),
      minutesLeft: Math.round((window.start - now) / 60_000),
      counts,
      dashboardUrl: dashboardUrl(),
    });
    try {
      for (const to of recipients) await sendGmail({ to, ...email });
      result.preclassSent += 1;
      log.info('Pre-class reminder sent', { session: session.id, reminder: key, waiting: counts.reduce((s, [, n]) => s + n, 0) });
    } catch (err) {
      // Let the next run retry inside the same window.
      await markRef.delete().catch(() => {});
      log.warn('Pre-class reminder failed', { session: session.id, reminder: key, code: err?.code });
    }
  }

  if (subrequestsRemaining() >= 4 + RESERVE) await purgeMarks(db, now, result);
}
