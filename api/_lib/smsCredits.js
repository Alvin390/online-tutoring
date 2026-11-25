import { FieldValue } from './firebaseAdmin.js';
import { ApiError } from './errors.js';
import { mergePlans, planFor, TRIAL_SMS_UNITS } from './plans.js';
import { applySchoolOverrides } from './schoolOverrides.js';
import { nairobiMonth } from './usage.js';
import { schoolPlan } from './schoolPlan.js';

/**
 * The school's SMS units — 013Fixes / 14 (spec §9; owner answers 2–5).
 *
 * Two balances, kept apart so expiry and carry-over are right:
 *   - INCLUDED units, granted per window by the plan (Bronze 0, Silver 1,000,
 *     Gold 3,000; a trial 100 whatever the plan), written off when the next
 *     window starts;
 *   - TOP-UP units the superadmin adds by hand after an off-platform payment
 *     (no checkout yet), carried forward until used.
 *
 * The window: a paying school's own period (`period-<start>`), a trial
 * (`trial-<start>`), a comp school — or one with no period — the Nairobi
 * calendar month (`month-YYYY-MM`).
 *
 * Granting is LAZY, inside the transaction that first needs the balance, so
 * there is no cron. An upgrade inside a window adds the difference, once:
 * `granted` is the most this window has ever been granted, and only a higher
 * plan raises it. A downgrade never takes units away mid-window.
 *
 * Every change is an entry in the append-only ledger `sms/credits/ledger`,
 * many with a deterministic id so a retried call can't count twice. No
 * money appears anywhere here — units only (the owner's prices stay theirs).
 *
 * State: `sms/credits` { windowId, granted, includedUsed, topup, tier, updatedAt }.
 * Closed to browsers by the existing `sms/**` rule.
 */

const STATE = 'sms/credits';
const LEDGER = 'sms/credits/ledger';

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Which window a school is in, and what that window grants. Pure. */
export function creditWindow(sub, overrides, nowMs) {
  const tier = sub?.tier ?? null;
  // 013Fixes / 22: a school's own SMS units override counts too.
  const planUnits = applySchoolOverrides(planFor(tier, mergePlans(overrides)), sub?.schoolOverrides).limits.smsUnits;
  const start = toMs(sub?.currentPeriodStart);
  if (sub?.grantedBySuperadmin !== true && start != null && start <= nowMs) {
    if (sub?.status === 'trialing') {
      return { windowId: `trial-${start}`, units: planUnits > 0 ? TRIAL_SMS_UNITS : 0, tier, kind: 'trial' };
    }
    return { windowId: `period-${start}`, units: planUnits, tier, kind: 'period' };
  }
  const { start: monthStart } = nairobiMonth(nowMs);
  const local = new Date(monthStart + 3 * 3_600_000);
  const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
  return { windowId: `month-${key}`, units: planUnits, tier, kind: 'month' };
}

/** What the screens and checks need from the stored state. */
export function creditView(state) {
  const granted = state?.granted ?? 0;
  const includedUsed = state?.includedUsed ?? 0;
  const includedLeft = Math.max(0, granted - includedUsed);
  const topup = Math.max(0, state?.topup ?? 0);
  return {
    windowId: state?.windowId ?? null, granted, includedUsed, includedLeft, topup, available: includedLeft + topup,
  };
}

/**
 * Inside a transaction: bring the state to the current window (grant, expire,
 * upgrade difference) and return it. Writes only when something changed.
 * @returns {Promise<{ state: object, writes: Array<[string, object]> }>}
 */
export async function ensureInTx(tx, db, { sub, overrides, nowMs, actor = 'system:sms' }) {
  const ref = db.doc(STATE);
  const snap = await tx.get(ref);
  const before = snap.exists ? snap.data() : null;
  const win = creditWindow(sub, overrides, nowMs);
  const at = new Date(nowMs);
  const entries = [];
  let state = before ? { ...before } : { windowId: null, granted: 0, includedUsed: 0, topup: 0 };

  if (state.windowId !== win.windowId) {
    const leftover = Math.max(0, (state.granted ?? 0) - (state.includedUsed ?? 0));
    if (state.windowId && leftover > 0) {
      entries.push([`expire:${state.windowId}`, { type: 'expire', units: -leftover, windowId: state.windowId, actor, at }]);
    }
    state = { ...state, windowId: win.windowId, granted: win.units, includedUsed: 0, tier: win.tier };
    if (win.units > 0) entries.push([`grant:${win.windowId}`, { type: 'grant', units: win.units, windowId: win.windowId, tier: win.tier, actor, at }]);
  } else if (win.units > (state.granted ?? 0)) {
    const diff = win.units - (state.granted ?? 0);
    entries.push([`upgrade:${win.windowId}:${win.units}`, { type: 'upgrade_top', units: diff, windowId: win.windowId, tier: win.tier, actor, at }]);
    state = { ...state, granted: win.units, tier: win.tier };
  }

  const changed = entries.length > 0 || !before;
  if (changed) {
    tx.set(ref, { ...state, updatedAt: FieldValue.serverTimestamp() });
    for (const [id, entry] of entries) tx.set(db.doc(`${LEDGER}/${id}`), entry);
  }
  return { state, ref };
}

/** The current balance (granting first if a new window has begun). */
export async function readCredits(db, { sub, overrides, nowMs = Date.now() }) {
  const { state } = await db.runTransaction((tx) => ensureInTx(tx, db, { sub, overrides, nowMs }));
  return creditView(state);
}

/**
 * The superadmin adds top-up units (owner answer 3). `key` comes from the
 * form, so a double click adds once: the ledger entry `topup:<key>` is
 * created in the same transaction, and an existing one means "already done".
 */
export async function addTopup(db, { units, note = null, key, actor, sub, overrides, nowMs = Date.now() }) {
  if (!Number.isInteger(units) || units < 1 || units > 1_000_000) {
    throw new ApiError(400, 'bad_units', 'Enter a whole number of SMS units, at least 1.');
  }
  return db.runTransaction(async (tx) => {
    const entryRef = db.doc(`${LEDGER}/topup:${key}`);
    const existing = await tx.get(entryRef);
    const { state, ref } = await ensureInTx(tx, db, { sub, overrides, nowMs, actor });
    if (existing.exists) return { added: 0, already: true, credits: creditView(state) };
    const next = { ...state, topup: (state.topup ?? 0) + units };
    tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
    tx.set(entryRef, { type: 'topup_added', units, note: note ? String(note).slice(0, 120) : null, actor, windowId: state.windowId, at: new Date(nowMs) });
    return { added: units, already: false, credits: creditView(next) };
  });
}

/** The latest ledger entries, newest first (superadmin). */
export async function recentLedger(db, limit = 20) {
  const snap = await db.collection(LEDGER).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const e = d.data();
    return { id: d.id, type: e.type, units: e.units, windowId: e.windowId ?? null, campaignId: e.campaignId ?? null, note: e.note ?? null, actor: e.actor ?? null, at: e.at?.toDate?.()?.toISOString?.() ?? null };
  });
}

/** The subscription (fresh) and the plan settings (cached) the credits are worked out from. */
export async function creditContext(db) {
  const [subSnap, plan] = await Promise.all([db.doc('subscription/current').get(), schoolPlan(db)]);
  return { sub: subSnap.exists ? subSnap.data() : null, overrides: plan.overrides ?? null };
}

/**
 * What the screens show, WITHOUT writing (013Fixes / 16): the stored state as
 * it would be in the current window — a new window shows its fresh grant and
 * the carried top-up, exactly what the next send will find.
 */
export async function peekCredits(db, { sub, overrides, nowMs = Date.now() }) {
  const snap = await db.doc(STATE).get();
  const state = snap.exists ? snap.data() : null;
  const win = creditWindow(sub, overrides, nowMs);
  if (!state || state.windowId !== win.windowId) {
    return { ...creditView({ windowId: win.windowId, granted: win.units, includedUsed: 0, topup: state?.topup ?? 0 }), kind: win.kind };
  }
  return { ...creditView({ ...state, granted: Math.max(state.granted ?? 0, win.units) }), kind: win.kind };
}

/** The refusal when the units are not enough (no money in it; owner answer 3). */
export function unitsExhausted() {
  return new ApiError(402, 'sms_credit_exhausted', "You've used your SMS units. Contact us for more.");
}

/**
 * Inside the chunk's claim transaction (013Fixes / 15): take `units` from the
 * balance — included first, then top-up — or answer null when there are not
 * enough. Written with the claim, so a chunk is charged exactly once.
 * Reads must come before this (it reads the state, then writes).
 */
export async function reserveInTx(tx, db, { sub, overrides, nowMs, units, campaignId, chunkId, actor }) {
  const { state, ref } = await ensureInTx(tx, db, { sub, overrides, nowMs, actor });
  const view = creditView(state);
  if (view.available < units) return null;
  const fromIncluded = Math.min(units, view.includedLeft);
  const fromTopup = units - fromIncluded;
  const next = { ...state, includedUsed: (state.includedUsed ?? 0) + fromIncluded, topup: (state.topup ?? 0) - fromTopup };
  tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() });
  tx.set(db.doc(`${LEDGER}/reserve:${campaignId}:${chunkId}`), {
    type: 'reserve', units: -units, fromIncluded, fromTopup, windowId: state.windowId, campaignId, actor, at: new Date(nowMs),
  });
  return { fromIncluded, fromTopup, windowId: state.windowId };
}

/**
 * After the chunk: give back the units of everyone NOT sent (failed, or put
 * back in the queue). Top-up first, then included; if the window changed in
 * between, it all goes back as top-up (the old window's included units are
 * gone). Idempotent by the ledger id.
 */
export async function refundUnits(db, { units, reservation, campaignId, chunkId, nowMs = Date.now(), actor }) {
  if (!(units > 0) || !reservation) return { refunded: 0 };
  return db.runTransaction(async (tx) => {
    const entryRef = db.doc(`${LEDGER}/refund:${campaignId}:${chunkId}`);
    const [existing, snap] = await Promise.all([tx.get(entryRef), tx.get(db.doc(STATE))]);
    if (existing.exists || !snap.exists) return { refunded: 0 };
    const state = snap.data();
    let toTopup = Math.min(units, reservation.fromTopup);
    let toIncluded = units - toTopup;
    if (state.windowId !== reservation.windowId) { toTopup = units; toIncluded = 0; }
    const next = {
      ...state,
      topup: (state.topup ?? 0) + toTopup,
      includedUsed: Math.max(0, (state.includedUsed ?? 0) - toIncluded),
    };
    tx.set(db.doc(STATE), { ...next, updatedAt: FieldValue.serverTimestamp() });
    tx.set(entryRef, { type: 'refund', units, toIncluded, toTopup, windowId: state.windowId, campaignId, actor, at: new Date(nowMs) });
    return { refunded: units };
  });
}

export const CREDIT_PATHS = { STATE, LEDGER };
