import { sendGmail, GmailError } from './gmail.js';

/**
 * Bug reports and feature requests — Phase 13 / 06.
 *
 * Shared by the submit endpoint, the superadmin endpoints and the retry sweep.
 * Reports live at `reports/{id}` (server-only in firestore.rules); the id is a
 * client-generated UUID, which doubles as the idempotency key so a retried
 * submit never creates two reports or sends two emails.
 */

export const REPORT_TYPES = Object.freeze(['bug', 'feature']);
export const BUG_STATUSES = Object.freeze(['new', 'acknowledged', 'in_progress', 'resolved', 'wont_fix']);
export const FEATURE_STATUSES = Object.freeze(['new', 'reviewing', 'quoted', 'accepted', 'declined', 'shipped']);
export const SEVERITIES = Object.freeze(['blocking', 'annoying', 'cosmetic']);
export const URGENCIES = Object.freeze(['soon', 'whenever']);
export const MAX_ATTACHMENTS = 3;
/** Per image after browser compression: base64 of this + JSON fits 256 KB. */
export const MAX_FULL_BYTES = 185_000;
export const MAX_THUMB_BYTES = 40_000;
export const MAX_EMAIL_ATTEMPTS = 8;
export const DEFAULT_RECIPIENT = 'alvinmk06@gmail.com';

export const statusesFor = (type) => (type === 'bug' ? BUG_STATUSES : FEATURE_STATUSES);

const LABEL = {
  bug: { prefix: 'BUG', subject: 'Bug' },
  feature: { prefix: 'FR', subject: 'Feature request' },
};

export function formatReportNumber(type, n) {
  return `${LABEL[type].prefix}-${String(n).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Response deadline — the promise in the disclaimers
// ---------------------------------------------------------------------------

const EAT_MS = 3 * 60 * 60 * 1000; // Kenya: UTC+3, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bugs: 36 hours. Features: 3 working days (Mon–Fri, Nairobi time), at the
 * same time of day — Friday 17:00 is due Wednesday 17:00, and a weekend
 * submission counts from Monday.
 */
export function responseDueAt(type, createdAtMs) {
  if (type === 'bug') return createdAtMs + 36 * 60 * 60 * 1000;

  let due = createdAtMs;
  let added = 0;
  while (added < 3) {
    due += DAY_MS;
    const weekday = new Date(due + EAT_MS).getUTCDay(); // 0 = Sunday
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return due;
}

export function formatNairobi(ms) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Africa/Nairobi', hour12: false,
  }).format(new Date(ms));
}

// ---------------------------------------------------------------------------
// Numbering and settings
// ---------------------------------------------------------------------------

/** BUG-0001, FR-0001 … — a transaction on one counters document. */
export async function nextReportNumber(db, type) {
  const ref = db.doc('counters/reports');
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists ? snap.data()[type] ?? 0 : 0) + 1;
    tx.set(ref, { [type]: next }, { merge: true });
    return next;
  });
  return formatReportNumber(type, n);
}

/** `config/notifications`, created with the default recipient on first read. */
export async function getNotificationSettings(db) {
  const ref = db.doc('config/notifications');
  const snap = await ref.get();
  if (snap.exists && snap.data().reportRecipient) return snap.data();

  const defaults = { reportRecipient: DEFAULT_RECIPIENT, createdAt: new Date() };
  try {
    await ref.create(defaults);
  } catch (err) {
    if (err?.code !== 6 && err?.code !== 'already-exists') throw err;
    return (await ref.get()).data();
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * Subject + plain text + HTML for one report. Deliberately conservative for
 * spam filters: no images, no tracking, no URL shorteners; screenshots are a
 * link to the superadmin viewer, never attachments.
 */
export function buildReportEmail(report, { baseUrl = '' } = {}) {
  const who = report.submittedBy?.displayName || report.submittedBy?.email || 'A teacher';
  const tier = report.context?.tier ? ` (${cap(report.context.tier)})` : '';
  const level = report.type === 'bug' ? cap(report.severity) : null;
  const subject = [
    `[${LABEL[report.type].subject}] ${report.number}`,
    ...(level ? [level] : []),
    `${report.title} — ${who}${tier}`,
  ].join(' · ');

  const due = formatNairobi(report.responseDueAtMs);
  const link = `${String(baseUrl).replace(/\/$/, '')}/superadmin?tab=${report.type === 'bug' ? 'bugs' : 'features'}&report=${encodeURIComponent(report.id)}`;

  const fields = report.type === 'bug'
    ? [
      ['What happened', report.description],
      ['Steps to reproduce', report.steps],
      ['Expected', report.expected],
      ['Severity', cap(report.severity)],
    ]
    : [
      ['What they would like', report.description],
      ['Problem it solves', report.problem],
      ['How soon', report.urgency === 'soon' ? 'Soon' : 'Whenever convenient'],
    ];

  const context = [
    ['Teacher', `${who}${report.submittedBy?.email ? ` <${report.submittedBy.email}>` : ''}`],
    ['Plan', cap(report.context?.tier) ?? '—'],
    ['Page', report.context?.page],
    ['Browser', report.context?.userAgent],
    ['Screen', report.context?.viewport],
    ['App version', [report.context?.appVersion, report.context?.buildHash].filter(Boolean).join(' · ')],
  ];
  const shots = (report.attachments ?? []).length;

  const text = [
    `${LABEL[report.type].subject} ${report.number}: ${report.title}`,
    `Reply due by ${due} (Nairobi).`,
    '',
    ...fields.filter(([, v]) => v).map(([k, v]) => `${k}:\n${v}\n`),
    'Context:',
    ...context.filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`),
    '',
    shots ? `${shots} screenshot${shots === 1 ? '' : 's'} — view in superadmin: ${link}` : `View in superadmin: ${link}`,
    '',
    'Reply to this email to answer the teacher directly.',
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
<h2 style="margin:0 0 4px">${escapeHtml(LABEL[report.type].subject)} ${escapeHtml(report.number)}: ${escapeHtml(report.title)}</h2>
<p style="margin:0 0 16px;color:#b45309"><strong>Reply due by ${escapeHtml(due)}</strong> (Nairobi time)</p>
${fields.filter(([, v]) => v).map(([k, v]) => `<p style="margin:0 0 12px"><strong>${escapeHtml(k)}</strong><br>${escapeHtml(v).replace(/\n/g, '<br>')}</p>`).join('\n')}
<table style="border-collapse:collapse;font-size:13px;color:#4b5563">
${context.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('\n')}
</table>
<p><a href="${escapeHtml(link)}">${shots ? `View ${shots} screenshot${shots === 1 ? '' : 's'} in superadmin` : 'View in superadmin'}</a></p>
<p style="color:#6b7280;font-size:12px">Reply to this email to answer the teacher directly.</p>
</body></html>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Sending, with retry state
// ---------------------------------------------------------------------------

/** Minutes to wait before attempt n+1: 1, 2, 4 … capped at 60. */
export function retryDelayMinutes(attempts) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

/**
 * Sends a report's email and records the outcome on the report. Never throws:
 * the report is already saved, and a failure is recorded for the retry sweep.
 *
 * @returns {Promise<{sent: boolean, code?: string}>}
 */
export async function sendReportEmail(db, reportId, { log } = {}) {
  const ref = db.doc(`reports/${reportId}`);
  const snap = await ref.get();
  if (!snap.exists) return { sent: false, code: 'missing' };
  const report = { id: reportId, ...snap.data() };
  if (report.email?.status === 'sent') return { sent: true };

  const attempts = (report.email?.attempts ?? 0) + 1;
  const settingsRef = db.doc('config/notifications');

  try {
    const settings = await getNotificationSettings(db);
    const email = buildReportEmail(
      { ...report, responseDueAtMs: report.responseDueAt?.toMillis?.() ?? Number(report.responseDueAt) },
      { baseUrl: process.env.PUBLIC_BASE_URL }
    );
    const result = await sendGmail({
      to: settings.reportRecipient,
      replyTo: report.submittedBy?.email || undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    await ref.set({
      email: {
        status: 'sent', attempts, sentAt: new Date(), gmailId: result.id,
        recipient: settings.reportRecipient, lastError: null, nextAttemptAt: null,
      },
    }, { merge: true });
    await settingsRef.set({ gmail: { lastSuccessAt: new Date(), lastError: null, disconnected: false } }, { merge: true });
    log?.info?.('Report email sent', { number: report.number, attempts });
    return { sent: true };
  } catch (err) {
    const gmail = err instanceof GmailError;
    const retryable = gmail ? err.retryable : true;
    const exhausted = attempts >= MAX_EMAIL_ATTEMPTS;
    const nextAttemptAt = retryable && !exhausted
      ? new Date(Date.now() + retryDelayMinutes(attempts) * 60_000)
      : null;

    // A failure that will not be retried gets a TERMINAL status, so it drops
    // out of the sweep's `status in [pending, failed]` query instead of
    // occupying a slot in it forever. "Resend" on the superadmin page resets it.
    await ref.set({
      email: {
        status: nextAttemptAt ? 'failed' : 'needs_attention',
        attempts, lastError: String(err?.message ?? err).slice(0, 300),
        errorCode: gmail ? err.code : 'unknown', nextAttemptAt,
      },
    }, { merge: true });

    if (gmail && (err.code === 'invalid_grant' || err.code === 'not_configured')) {
      await settingsRef.set({ gmail: { lastError: err.message, disconnected: true, lastErrorAt: new Date() } }, { merge: true });
    }
    log?.warn?.('Report email failed', { number: report.number, attempts, code: gmail ? err.code : 'unknown', retry: Boolean(nextAttemptAt) });
    return { sent: false, code: gmail ? err.code : 'unknown' };
  }
}
