import { getAdminAuth } from './firebaseAdmin.js';
import { gmailConfigured, sendGmail, GmailError } from './gmail.js';
import { getNotificationSettings } from './reports.js';
import { TIER_PRICE_KES } from './paystack.js';

/**
 * Reminder emails — 013Fixes / 23 (owner suggestion 7). The hourly sweep
 * queues the step that is due (billing/reminders/queue, see dueReminders)
 * and then sends what is queued, here: to the school owner's login email,
 * with a copy to the owner's notification address (config/notifications).
 *
 *   sent once; a failure is tried again next hour, 3 tries in all, then
 *   'gave_up' (left for a person); a reminder more than two days past its
 *   end is 'stale', never sent late. At most SEND_BATCH a run, one query.
 *   No address ever goes to the logs.
 *
 * The wording is plain: the date (Nairobi), the plan's current price, and
 * where to pay. Nothing about grace (there is none).
 */

const MAX_ATTEMPTS = 3;
const SEND_BATCH = 5;
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const QUEUE = 'billing/reminders/queue';

const TIER_NAMES = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

const when = (ms) => new Date(ms).toLocaleString('en-KE', {
  day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
});
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NAIROBI_MS = 3 * 60 * 60 * 1000;
const nairobiDay = (ms) => Math.floor((ms + NAIROBI_MS) / 86_400_000);

/**
 * "today" / "tomorrow" / "in 3 days": from the time actually left when the
 * email goes, by Nairobi's calendar — never from the step's name, which would
 * say "in 3 days" to a school that reached the ladder late (a release
 * mid-ladder, a missed run) with a day left.
 */
function whenItEnds(endsAt, now) {
  const days = nairobiDay(endsAt) - nairobiDay(now);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** The email for one reminder. Pure, so the wording is tested alone. */
export function buildReminderEmail({ reminderId, kind, tier, endsAt, priceKes, baseUrl, now = Date.now() }) {
  const plan = TIER_NAMES[tier] ?? 'your';
  const date = when(endsAt);
  const link = `${(baseUrl ?? '').replace(/\/$/, '')}/billing`;
  const price = priceKes ? `${kes(priceKes)} a month` : null;
  const pay = `Pay from Billing in your dashboard, by M-Pesa or card: ${link}`;

  let subject;
  let lines;
  if (reminderId === 'at_lock') {
    subject = 'Your account is locked';
    lines = [
      `Your ${plan} plan ended on ${date}, so your Online Tutoring account is locked.`,
      'Your classes, students and records are all kept.',
      `Pay for the next month${price ? ` (${price})` : ''} and your account opens again straight away.`,
      pay,
    ];
  } else if (kind === 'card_failed') {
    subject = 'Your card payment did not go through';
    lines = [
      `We could not take this month's payment for your ${plan} plan from your card.`,
      `Your account locks on ${date} unless the payment comes in.`,
      `Check your card, or pay by M-Pesa instead${price ? ` (${price})` : ''}.`,
      pay,
    ];
  } else {
    const ends = whenItEnds(endsAt, now);
    subject = kind === 'trial' ? `Your free trial ends ${ends}` : `Your plan ends ${ends}`;
    lines = [
      kind === 'trial'
        ? `Your free ${plan} trial ends on ${date}.`
        : `Your ${plan} plan ends on ${date}.`,
      `To keep going without a break, pay for the next month${price ? ` (${price})` : ''} before then.`,
      pay,
    ];
  }
  const text = [...lines, 'Online Tutoring'].join('\n\n');
  const html = `${lines.map((l) => `<p>${escapeHtml(l).replace(escapeHtml(link), `<a href="${link}">${escapeHtml(link)}</a>`)}</p>`).join('')}<p>Online Tutoring</p>`;
  return { subject, text, html };
}

/** The owner's login email and the notification copy, without duplicates. */
async function recipients(db, sub) {
  const out = [];
  if (sub?.ownerUid) {
    try {
      const owner = await getAdminAuth().getUser(sub.ownerUid);
      if (owner?.email) out.push(owner.email.toLowerCase());
    } catch {
      // No owner login (deleted, or never set): the copy still goes.
    }
  }
  try {
    const settings = await getNotificationSettings(db);
    if (settings?.reportRecipient) out.push(String(settings.reportRecipient).toLowerCase());
  } catch {
    // The copy is a convenience; the owner's email is the one that matters.
  }
  return [...new Set(out)];
}

/**
 * Sends what is queued (at most SEND_BATCH). Never throws: a mail problem must
 * not fail the sweep. @returns {{ sent: number, failed: number, stale: number }}
 */
export async function sendQueuedReminders(db, { sub, log, now = Date.now() }) {
  const result = { sent: 0, failed: 0, stale: 0 };
  if (!gmailConfigured()) {
    log?.warn?.('Reminder emails waiting: Gmail is not configured');
    return result;
  }
  const snap = await db.collection(QUEUE).where('status', 'in', ['queued', 'failed']).limit(SEND_BATCH).get();
  if (snap.empty) return result;

  const to = await recipients(db, sub);
  for (const doc of snap.docs) {
    const q = doc.data();
    const endsAt = q.endsAt?.toMillis?.() ?? (q.endsAt instanceof Date ? q.endsAt.getTime() : null);
    const attempts = (q.attempts ?? 0) + 1;
    if (endsAt == null || now - endsAt > STALE_AFTER_MS) {
      await doc.ref.set({ status: 'stale', staleAt: new Date(now) }, { merge: true });
      result.stale += 1;
      continue;
    }
    try {
      if (to.length === 0) throw new GmailError('no_recipient', 'No address to send the reminder to.', { retryable: false });
      const email = buildReminderEmail({
        reminderId: q.reminderId, kind: q.kind, tier: q.tier, endsAt,
        priceKes: TIER_PRICE_KES[q.tier] ?? null, baseUrl: process.env.PUBLIC_BASE_URL, now,
      });
      // The owner in To, the notification address as the copy (one address each).
      const sent = await sendGmail({ to: to[0], cc: to[1], subject: email.subject, text: email.text, html: email.html });
      await doc.ref.set({ status: 'sent', attempts, sentAt: new Date(now), gmailId: sent.id, recipients: to.length, lastError: null }, { merge: true });
      result.sent += 1;
    } catch (err) {
      const code = err instanceof GmailError ? err.code : 'unknown';
      const status = attempts >= MAX_ATTEMPTS || code === 'no_recipient' ? 'gave_up' : 'failed';
      await doc.ref.set({ status, attempts, lastError: code, lastTriedAt: new Date(now) }, { merge: true });
      result.failed += 1;
      // The code and the count only: never an address.
      log?.warn?.('Reminder email not sent', { reminderId: q.reminderId, attempts, code, status });
    }
  }
  if (result.sent || result.failed || result.stale) log?.info?.('Reminder emails', result);
  return result;
}
