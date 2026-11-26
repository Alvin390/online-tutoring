import { readRegistry } from './registry.js';
import { schoolsTable } from './table.js';

/**
 * The daily digest email to the owner — 013Fixes / 38c. Every morning (the
 * console's cron, 07:00 Nairobi) the console checks every school and emails
 * the owner the ones that need a look:
 *   ending in 7 days or less, locked or expired, over a usage limit, low on
 *   SMS units (under 10 % of the month's), or can't be reached.
 * Nothing to report → no email. No digest address set → no email. Sent to the
 * console's digest address only (KV "settings".digestTo), through the same
 * Gmail sender as the schools (the console's own GMAIL_* secrets).
 */

const SETTINGS = 'settings';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function readSettings(kv) {
  const s = await kv.get(SETTINGS, 'json');
  return { digestTo: typeof s?.digestTo === 'string' && s.digestTo ? s.digestTo : null };
}

/** '' or null switches the digest off. @returns the saved settings, or throws a 400-coded error. */
export async function saveDigestTo(kv, value) {
  const v = String(value ?? '').trim();
  if (v && (v.length > 200 || !EMAIL.test(v))) throw Object.assign(new Error('Enter a valid email address (or leave it empty to stop the digest).'), { status: 400, code: 'bad_email' });
  const next = { digestTo: v || null };
  await kv.put(SETTINGS, JSON.stringify(next));
  return next;
}

function reasons(r) {
  if (!r.reachable) return [`can't reach it (${r.error})`];
  const out = [];
  if (r.statusClass === 'bad') out.push(r.status);
  if (r.daysClass === 'warn') out.push(`ends in ${r.daysLeft}`);
  else if (r.daysClass === 'bad' && r.statusClass !== 'bad') out.push('ended');
  if (r.usageClass === 'bad') out.push(`over a usage limit (${r.usage})`);
  if (r.smsClass === 'warn' || r.smsClass === 'bad') out.push(`low on SMS (${r.sms})`);
  return out;
}

/** The email for these rows, or null when nothing needs a look. */
export function digestFor(rows) {
  const items = rows.map((r) => ({ r, why: reasons(r) })).filter((x) => x.why.length > 0);
  if (items.length === 0) return null;
  const n = items.length;
  const subject = `Owner console: ${n} ${n === 1 ? 'school needs' : 'schools need'} a look`;
  const lines = items.map(({ r, why }) => `- ${r.name}: ${why.join('; ')}\n  ${r.superadminUrl}`);
  const text = [
    `Good morning. ${n === 1 ? 'One school needs' : `${n} schools need`} a look today:`,
    '',
    ...lines,
    '',
    'Changes are made in each school’s own superadmin. This email is automatic; please don’t reply to it.',
  ].join('\n');
  return { subject, text, count: n };
}

async function gmailSend(message) {
  const { sendGmail, gmailConfigured } = await import('../../api/_lib/gmail.js');
  if (!gmailConfigured()) throw new Error('Gmail is not set up on the console (GMAIL_* secrets).');
  return sendGmail(message);
}

/** The cron's job. Never throws. */
export async function runDigest(env, { send = gmailSend, fetchImpl, now = Date.now() } = {}) {
  const { digestTo } = await readSettings(env.CONSOLE_KV);
  if (!digestTo) return { sent: false, reason: 'no_recipient' };
  const schools = await readRegistry(env.CONSOLE_KV);
  const rows = await schoolsTable(schools, env, { now, ...(fetchImpl ? { fetchImpl } : {}) });
  const digest = digestFor(rows);
  if (!digest) return { sent: false, reason: 'nothing_to_report' };
  try {
    await send({ to: digestTo, subject: digest.subject, text: digest.text });
    return { sent: true, schools: digest.count };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Console digest not sent', error: String(err?.message ?? err).slice(0, 200) }));
    return { sent: false, reason: 'send_failed' };
  }
}
