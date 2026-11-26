import { fetchSchoolStatus } from './fetchStatus.js';

/**
 * The console's table — 013Fixes / 38b. Each school's status reply becomes
 * one row of plain text (the page only ever sets it as text), with a class
 * ('warn' / 'bad') where something needs the owner's eye.
 */

const D = 86_400_000;
const TZ = 'Africa/Nairobi';
const METHODS = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank', card: 'Card', mobile_money: 'Mobile money' };

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '—');
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });

function daysLeft(plan, now) {
  // The school's own countdown date (its billing window: trial or paid period
  // end). A gift has none by design — never fall back to an old period end.
  const end = plan?.endsAt ?? null;
  if (end == null) return { text: plan?.comp ? 'No end (gift)' : '—', cls: '' };
  const n = Math.ceil((end - now) / D);
  if (n <= 0) return { text: 'Ended', cls: 'bad' };
  return { text: n === 1 ? '1 day' : `${n} days`, cls: n <= 7 ? 'warn' : '' };
}

function usageText(u) {
  if (!u) return { text: 'Not counted yet', cls: '' };
  const part = (key, label) => `${u[key] ?? '?'}/${u.limits?.[key] ?? '?'} ${label}`;
  const pcts = Object.values(u.percent ?? {}).filter((v) => typeof v === 'number');
  const cls = pcts.some((p) => p > 100) ? 'bad' : pcts.some((p) => p >= 90) ? 'warn' : '';
  return { text: `${part('activeStudents', 'learners')} · ${part('sessions', 'sessions')} · ${part('logins', 'logins')}`, cls };
}

function smsText(s) {
  if (!s) return { text: '—', cls: '' };
  const cls = s.available <= 0 ? 'bad' : (s.granted > 0 && s.available < s.granted * 0.1 ? 'warn' : '');
  return { text: `${Number(s.available).toLocaleString('en-KE')} units left`, cls };
}

function modesText(st) {
  const m = st.modes ?? {};
  const parts = [];
  if (m.maintenance?.on) parts.push('MAINTENANCE');
  if (m.demo) parts.push('DEMO');
  if (m.payments === 'test') parts.push('Payments: test');
  if (m.sms === 'fake') parts.push('SMS: fake');
  const payNow = st.mpesa?.mode;
  if (payNow && payNow !== 'off') parts.push(`Pay now: ${payNow}`);
  const cls = m.maintenance?.on ? 'bad'
    : (m.demo || m.payments === 'test' || m.sms === 'fake' || payNow === 'demo') ? 'warn' : '';
  return { text: parts.length ? parts.join(' · ') : 'Normal', cls };
}

export function rowFor(school, result, now = Date.now()) {
  const base = { id: school.id, name: school.name, url: school.url, superadminUrl: `${school.url}/superadmin` };
  if (!result?.reachable) return { ...base, reachable: false, error: result?.error ?? 'no answer' };
  const st = result.status ?? {};
  const plan = st.plan;
  const status = plan?.status ?? null;
  const days = daysLeft(plan, now);
  const usage = usageText(st.usage);
  const sms = smsText(st.sms);
  const modes = modesText(st);
  const p = st.lastPayment;
  return {
    ...base,
    reachable: true,
    plan: plan ? `${cap(plan.tier)}${plan.comp ? ' (gift)' : ''}` : '—',
    status: cap(status),
    statusClass: ['locked', 'expired', 'cancelled'].includes(status) ? 'bad' : ['past_due', 'grace'].includes(status) ? 'warn' : '',
    daysLeft: days.text,
    daysClass: days.cls,
    lastPayment: p?.at ? `${p.amountKes != null ? kes(p.amountKes) : 'Paid'} on ${day(p.at)}${p.method ? ` (${METHODS[p.method] ?? cap(p.method)})` : ''}` : 'None yet',
    usage: usage.text,
    usageClass: usage.cls,
    sms: sms.text,
    smsClass: sms.cls,
    modes: modes.text,
    modesClass: modes.cls,
    version: st.version?.tag || (st.version?.id ? String(st.version.id).slice(0, 8) : '—'),
  };
}

/** Every school at once (in parallel); a failure is one row, never the page. */
export async function schoolsTable(schools, env, opts = {}) {
  const now = opts.now ?? Date.now();
  const results = await Promise.all(schools.map((s) => fetchSchoolStatus(s, env, { ...opts, now }).catch(() => ({ reachable: false, error: 'no answer' }))));
  return schools.map((s, i) => rowFor(s, results[i], now));
}
