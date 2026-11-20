import { FieldValue } from './firebaseAdmin.js';
import { effectiveApprovalStatus } from './studentState.js';
import { schoolPlan } from './schoolPlan.js';
import { seatState } from './logins.js';

/**
 * The school's usage against its plan — 013Fixes / 11 (spec §4).
 *
 * Soft limits: counting never blocks, warns or changes anything else. It
 * runs about once a day (on the hourly trigger, when the stored count is
 * older than RECOUNT_AFTER_MS) and on the superadmin's "Recount now", and is
 * stored in `config/usage`, so pages read one document.
 *
 * Active learners (owner: active, not every record ever):
 *   one per PHONE across all sessions (a learner in Morning and Evening is one),
 *   approved (a missing approvalStatus counts as approved, as everywhere),
 *   not staff, not held as a possible duplicate, not a retired number,
 *   and checked in during the window (meta/activity.lastAccessed).
 * Sessions: those switched on (`active !== false`). Logins: the seats in use.
 *
 * The window: a paying or trial school's own period (currentPeriodStart …
 * currentPeriodEnd); a comp school (owner answer 2) the Nairobi calendar
 * month. A school with no period falls back to the calendar month too.
 */

export const RECOUNT_AFTER_MS = 23 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
};

/** The 1st of this month and of next month, Nairobi time (as UTC ms). */
export function nairobiMonth(nowMs) {
  const local = new Date(nowMs + NAIROBI_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - NAIROBI_OFFSET_MS;
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - NAIROBI_OFFSET_MS;
  return { start, end };
}

/** @returns {{ start: number, end: number, kind: 'period'|'month' }} */
export function usageWindow(sub, nowMs) {
  const start = toMs(sub?.currentPeriodStart);
  const end = toMs(sub?.currentPeriodEnd);
  if (sub?.grantedBySuperadmin !== true && start != null && start <= nowMs) {
    return { start, end: end ?? nowMs, kind: 'period' };
  }
  return { ...nairobiMonth(nowMs), kind: 'month' };
}

/** Counts, without writing. `seats` (from seatState) may be passed to save its reads. */
export async function countUsage(db, { nowMs = Date.now(), seats = null } = {}) {
  const [sessionsSnap, subSnap] = await Promise.all([
    db.collection('sessions').get(),
    db.doc('subscription/current').get(),
  ]);
  const window = usageWindow(subSnap.exists ? subSnap.data() : null, nowMs);

  const learners = new Set();
  let sessions = 0;
  for (const session of sessionsSnap.docs) {
    if (session.data().active !== false) sessions += 1;
    // eslint-disable-next-line no-await-in-loop
    const [studentsSnap, retiredSnap] = await Promise.all([
      db.collection(`sessions/${session.id}/students`).get(),
      db.collection(`sessions/${session.id}/retiredNumbers`).get(),
    ]);
    const retired = new Set(retiredSnap.docs.map((d) => d.id));
    const candidates = studentsSnap.docs.filter((d) => {
      const s = d.data();
      return effectiveApprovalStatus(s) === 'approved'
        && s.staff !== true
        && s.duplicateHold !== true
        && !retired.has(d.id)
        && !learners.has(d.id);
    });
    if (candidates.length === 0) continue;
    // eslint-disable-next-line no-await-in-loop
    const activity = await db.getAll(...candidates.map((d) => d.ref.collection('meta').doc('activity')));
    activity.forEach((snap, i) => {
      const last = snap.exists ? toMs(snap.data().lastAccessed) : null;
      if (last != null && last >= window.start) learners.add(candidates[i].id);
    });
  }

  const seatsNow = seats ?? await seatState(db);
  return { activeStudents: learners.size, sessions, logins: seatsNow.used, window };
}

const percent = (used, limit) => (limit > 0 ? Math.round((used / limit) * 100) : (used > 0 ? 100 : 0));

/** Counts and stores `config/usage` (with each count's limit and percentage). */
export async function recountUsage(db, { nowMs = Date.now(), by = 'system:usage' } = {}) {
  // The seats once (they carry the logins in use and the limit).
  const [plan, seats] = await Promise.all([schoolPlan(db), seatState(db)]);
  const counts = await countUsage(db, { nowMs, seats });
  const limits = { activeStudents: plan.limits.activeStudents, sessions: plan.limits.sessions, logins: seats.limit };
  const usage = {
    activeStudents: counts.activeStudents,
    sessions: counts.sessions,
    logins: counts.logins,
    limits,
    percent: {
      activeStudents: percent(counts.activeStudents, limits.activeStudents),
      sessions: percent(counts.sessions, limits.sessions),
      logins: percent(counts.logins, limits.logins),
    },
    tier: plan.tier,
    windowStart: new Date(counts.window.start),
    windowEnd: new Date(counts.window.end),
    windowKind: counts.window.kind,
    countedAtMs: nowMs,
    countedBy: by,
  };
  await db.doc('config/usage').set({ ...usage, countedAt: FieldValue.serverTimestamp() });
  return usage;
}

/** For the hourly trigger: recount only when the stored count is a day old. */
export async function recountIfStale(db, { nowMs = Date.now() } = {}) {
  const snap = await db.doc('config/usage').get();
  const last = snap.exists ? snap.data().countedAtMs ?? 0 : 0;
  if (nowMs - last < RECOUNT_AFTER_MS) return { recounted: false };
  return { recounted: true, usage: await recountUsage(db, { nowMs }) };
}
