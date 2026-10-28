import { FieldValue, Timestamp } from './firebaseAdmin.js';
import { postEntry, reverseEntry } from './ledger.js';
import { effectiveApprovalStatus } from './studentState.js';
import { shouldAutoUnblock } from './feeState.js';
import { approvalFields, receiptIdFor, mpesaCodeFrom } from './receiptApproval.js';
import { badRequest, forbidden, notFound, ApiError } from './errors.js';

/**
 * Bulk actions on many students at once — 003Fixes / 04.
 *
 * One teacher action ("block these 127 students") is one `bulkActions/{id}`
 * document, however many calls it takes: the client sends the students in
 * chunks of `MAX_ITEMS[kind]`, the first call opens the batch and later calls
 * append to it by id. Every student touched gets an item recording exactly
 * what they looked like before, which is what Undo restores for 30 minutes.
 *
 * Retries are safe: a student whose item already says `done` is counted as
 * done and not written again, and fee charges are posted under an idempotency
 * key derived from the batch, so a repeated call never charges twice.
 *
 * Nothing here logs or returns a phone number or a name. Outcomes are counts,
 * and failures are reported by the item's index in the caller's chunk.
 */

export const UNDO_WINDOW_MS = 30 * 60_000;

/**
 * Students per call, by kind of work. Sized against the Worker's 45-subrequest
 * budget (measured in tests/handlers/fixes003/bulkBlock.test.js): a plain
 * block is one read and one commit for the whole chunk; a fee charge or a
 * reversal is a ledger transaction (≈3–5 subrequests) per student.
 */
export const MAX_ITEMS = Object.freeze({
  block: 25,
  blockFees: 8,
  unblock: 25,
  approveReceipts: 8,
  undo: 20,
  undoLedger: 6,
});

const BEFORE_FIELDS = ['blocked', 'blockReason', 'blockedAt', 'receiptStatus', 'pendingReceipt', 'unblockedAt', 'receiptMessage', 'receiptApprovedAt'];
// What Undo writes back, by action (only what that action changed).
const RESTORED = {
  block: ['blocked', 'blockReason', 'blockedAt', 'receiptStatus', 'pendingReceipt', 'unblockedAt'],
  unblock: ['blocked', 'blockReason', 'blockedAt', 'receiptStatus', 'pendingReceipt', 'unblockedAt'],
  approveReceipts: ['blocked', 'blockReason', 'blockedAt', 'receiptStatus', 'pendingReceipt', 'receiptMessage', 'receiptApprovedAt'],
};

export const batchRef = (db, id) => db.doc(`bulkActions/${id}`);
const itemId = (session, phone) => `${session}__${String(phone).replace(/\D/g, '')}`;
const itemRef = (db, batchId, session, phone) => db.doc(`bulkActions/${batchId}/items/${itemId(session, phone)}`);
const studentRef = (db, session, phone) => db.doc(`sessions/${session}/students/${phone}`);
const millis = (value) => value?.toMillis?.() ?? null;

function snapshotBefore(data) {
  const out = {};
  for (const key of BEFORE_FIELDS) out[key] = data[key] ?? null;
  return out;
}

/** The same student twice in one chunk counts once (the first index wins). */
function uniqueItems(items) {
  const seen = new Set();
  const out = [];
  items.forEach((item, index) => {
    const key = itemId(item.session, item.phone);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, index });
  });
  return out;
}

/**
 * Opens a new batch (returns the document to create in the same commit) or
 * checks that an existing one may be appended to: same teacher, same action,
 * not undone, still inside its undo window.
 */
export async function openBatch({ db, user, batchId, action, kind = null, amount = null, reason = null, nowMs, source = 'dashboard' }) {
  if (!batchId) {
    const ref = db.collection('bulkActions').doc();
    const data = {
      uid: user.uid,
      action,
      kind,
      amount,
      reason,
      source,
      status: 'done',
      createdAt: Timestamp.fromMillis(nowMs),
      createdAtMs: nowMs,
      undoUntilMs: nowMs + UNDO_WINDOW_MS,
      counts: {},
    };
    return { id: ref.id, ref, data, isNew: true };
  }

  const ref = batchRef(db, batchId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That bulk action was not found.', 'batch_not_found');
  const data = snap.data();
  if (data.uid !== user.uid) throw forbidden('That bulk action belongs to someone else.', 'batch_forbidden');
  if (data.action !== action || data.status !== 'done' || nowMs > data.undoUntilMs) {
    throw new ApiError(409, 'batch_closed', 'That bulk action can no longer be added to. Start a new one.');
  }
  return { id: batchId, ref, data, isNew: false };
}

/**
 * Applies `action` ('block' | 'unblock' | 'approveReceipts') to a chunk of students.
 *
 * approveReceipts (003Fixes / 06, owner decision): each student's whole
 * balance is recorded as paid, referenced with the M-Pesa code from their
 * receipt, then the receipt is approved exactly as the single approval does
 * (api/_lib/receiptApproval.js) — which lifts the block once nothing is owed.
 *
 * @returns {{ batchId, done, skipped: object, failed: Array<{index, code}>, undoUntilMs }}
 */
export async function applyStudents({
  db, user, batch, action, items, kind = 'other', amount = null, reason = null, nowMs, recordedBy,
  feesEnabled = false,
}) {
  const list = uniqueItems(items);
  const studentRefs = list.map((i) => studentRef(db, i.session, i.phone));
  const itemRefs = list.map((i) => itemRef(db, batch.id, i.session, i.phone));
  // Approving receipts needs each fee account's balance as well.
  const accountRefs = action === 'approveReceipts' ? list.map((i) => db.doc(`fees/accounts/items/${i.phone}`)) : [];
  // One round trip for the students, their items (a retry's done marks) and accounts.
  const snaps = await db.getAll(...studentRefs, ...(batch.isNew ? [] : itemRefs), ...accountRefs);
  const studentSnaps = snaps.slice(0, list.length);
  const itemSnaps = batch.isNew ? [] : snaps.slice(list.length, 2 * list.length);
  const accountSnaps = accountRefs.length ? snaps.slice(snaps.length - list.length) : [];

  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const failed = [];
  let alreadyDone = 0;
  const toApply = [];

  list.forEach((item, i) => {
    if (itemSnaps[i]?.exists && itemSnaps[i].data().outcome === 'done') { alreadyDone += 1; return; }
    const snap = studentSnaps[i];
    if (!snap.exists) { skip('missing'); return; }
    const data = snap.data();
    if (action === 'block') {
      if (effectiveApprovalStatus(data) === 'pending') { skip('awaitingApproval'); return; }
      if (data.blocked === true) { skip('alreadyBlocked'); return; }
    } else if (action === 'unblock') {
      if (data.blocked !== true) { skip('notBlocked'); return; }
    } else if (action === 'approveReceipts') {
      if (!data.pendingReceipt) { skip('noReceipt'); return; }
    }
    const account = accountSnaps[i];
    toApply.push({ ...item, data, balance: account?.exists ? (account.data().balance ?? 0) : (data.feeBalance ?? 0) });
  });

  // Fee charges first, one ledger transaction each: a student whose charge
  // fails is not blocked (blocked with no balance to pay is a dead end).
  const applied = [];
  for (const item of toApply) {
    let entryId = null;
    let clearBlock = true;
    if (action === 'approveReceipts' && feesEnabled && item.balance > 0) {
      try {
        const posted = await postEntry({
          phone: item.phone,
          session: item.session,
          type: 'payment',
          amount: item.balance,
          method: 'mpesa',
          reference: mpesaCodeFrom(item.data.pendingReceipt),
          note: 'Recorded on receipt approval (bulk)',
          recordedBy,
          sourceReceiptId: receiptIdFor(item.phone, item.data, nowMs),
          // Keyed by the batch, not the receipt: if this approval is undone,
          // approving the same receipt again later must post a fresh payment.
          idempotencyKey: `bulk_${batch.id}_${itemId(item.session, item.phone)}`,
        });
        entryId = posted.entryId;
        clearBlock = shouldAutoUnblock(posted.balance);
      } catch (err) {
        failed.push({ index: item.index, code: err?.code && typeof err.code === 'string' ? err.code : 'payment_failed' });
        continue;
      }
      applied.push({ ...item, entryId, clearBlock });
      continue;
    }
    if (action === 'block' && kind === 'fees') {
      try {
        const posted = await postEntry({
          phone: item.phone,
          session: item.session,
          type: 'invoice',
          amount,
          note: 'Fees due — recorded when blocking',
          recordedBy,
          idempotencyKey: `bulk_${batch.id}_${itemId(item.session, item.phone)}`,
        });
        entryId = posted.entryId;
      } catch (err) {
        failed.push({ index: item.index, code: err?.code && typeof err.code === 'string' ? err.code : 'charge_failed' });
        continue;
      }
    }
    applied.push({ ...item, entryId, clearBlock });
  }

  const at = Timestamp.fromMillis(nowMs);
  const writes = db.batch();
  for (const item of applied) {
    let fields;
    if (action === 'block') fields = { blocked: true, blockReason: kind === 'fees' ? '' : (reason ?? ''), blockedAt: at, receiptStatus: 'expired' };
    else if (action === 'unblock') fields = { blocked: false, blockReason: '', blockedAt: null, receiptStatus: 'approved', pendingReceipt: null, unblockedAt: at };
    else fields = approvalFields(item.data, { clearBlock: item.clearBlock, approvedAt: at });
    writes.set(studentRef(db, item.session, item.phone), fields, { merge: true });
    writes.set(itemRef(db, batch.id, item.session, item.phone), {
      session: item.session,
      phone: item.phone,
      before: snapshotBefore(item.data),
      entryId: item.entryId,
      outcome: 'done',
      appliedAtMs: nowMs,
    });
  }
  const counts = Object.fromEntries(
    Object.entries({ done: applied.length, ...skipped, failed: failed.length }).filter(([, n]) => n)
  );
  if (batch.isNew) {
    // Created with this chunk's counts, in the same commit as its students.
    writes.set(batch.ref, { ...batch.data, counts });
  } else if (Object.keys(counts).length) {
    const increments = {};
    for (const [key, n] of Object.entries(counts)) increments[`counts.${key}`] = FieldValue.increment(n);
    writes.update(batch.ref, increments);
  }
  await writes.commit();

  return {
    batchId: batch.id,
    done: applied.length + alreadyDone,
    skipped,
    failed,
    undoUntilMs: batch.data.undoUntilMs,
  };
}

/** True when the student still looks exactly as this batch left them. */
function stillAsLeft(action, data, item) {
  if (action === 'block') return data.blocked === true && millis(data.blockedAt) === item.appliedAtMs;
  if (action === 'unblock') return data.blocked !== true && millis(data.unblockedAt) === item.appliedAtMs;
  if (action === 'approveReceipts') return millis(data.receiptApprovedAt) === item.appliedAtMs;
  return false;
}

/** The fields Undo writes back: the `before` snapshot, restored as it was. */
function restoreFields(action, before) {
  const fields = {};
  for (const key of RESTORED[action] ?? RESTORED.block) fields[key] = before?.[key] ?? null;
  fields.blocked = before?.blocked === true;
  if (typeof fields.blockReason !== 'string') fields.blockReason = '';
  return fields;
}

/**
 * Undoes a batch, a chunk at a time (`remaining: true` until it is finished).
 * Students changed since the action — paid, unblocked, blocked again — are
 * left alone and counted as `changedSince`.
 */
export async function undoBatch({ db, user, batchId, nowMs }) {
  const ref = batchRef(db, batchId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That bulk action was not found.', 'batch_not_found');
  const batch = snap.data();
  if (batch.uid !== user.uid && user.role !== 'superadmin') {
    throw forbidden('That bulk action belongs to someone else.', 'batch_forbidden');
  }
  if (batch.status === 'undone') {
    return { batchId, status: 'undone', remaining: false, undone: 0, changedSince: 0, missing: 0, failed: 0 };
  }
  if (nowMs > batch.undoUntilMs) {
    throw new ApiError(410, 'undo_expired', 'The 30 minutes to undo this have passed.');
  }

  const usesLedger = (batch.action === 'block' && batch.kind === 'fees') || batch.action === 'approveReceipts';
  const limit = usesLedger ? MAX_ITEMS.undoLedger : MAX_ITEMS.undo;
  const itemsSnap = await ref.collection('items').where('outcome', '==', 'done').limit(limit).get();
  const items = itemsSnap.docs.map((d) => ({ ref: d.ref, ...d.data() }));
  const studentSnaps = items.length ? await db.getAll(...items.map((i) => studentRef(db, i.session, i.phone))) : [];

  const tally = { undone: 0, changedSince: 0, missing: 0, failed: 0 };
  const writes = db.batch();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const studentSnap = studentSnaps[i];
    let outcome;
    if (!studentSnap.exists) outcome = 'missing';
    else if (!stillAsLeft(batch.action, studentSnap.data(), item)) outcome = 'changedSince';
    else {
      outcome = 'undone';
      if (item.entryId) {
        try {
          await reverseEntry({
            phone: item.phone,
            session: item.session,
            entryId: item.entryId,
            reason: 'Bulk action undone',
            recordedBy: user.uid,
          });
        } catch {
          outcome = 'failed';
        }
      }
      if (outcome === 'undone') {
        writes.set(studentRef(db, item.session, item.phone), restoreFields(batch.action, item.before), { merge: true });
      }
    }
    tally[outcome] += 1;
    writes.update(item.ref, { outcome, undoneAtMs: nowMs });
  }

  const remaining = items.length === limit;
  const increments = {};
  for (const [key, n] of Object.entries(tally)) if (n) increments[`counts.${key}`] = FieldValue.increment(n);
  if (!remaining) {
    increments.status = 'undone';
    increments.undoneAtMs = nowMs;
  }
  if (Object.keys(increments).length) writes.update(ref, increments);
  await writes.commit();

  return { batchId, status: remaining ? 'undoing' : 'undone', remaining, ...tally };
}

/** This teacher's actions from the last 30 minutes, newest first. */
export async function listRecent({ db, user, nowMs }) {
  // One single-field range query (no composite index); the uid filter is in
  // memory — a teacher makes a handful of bulk actions in 30 minutes.
  const snap = await db.collection('bulkActions').where('createdAtMs', '>=', nowMs - UNDO_WINDOW_MS).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => b.uid === user.uid)
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 20)
    .map((b) => ({
      id: b.id,
      action: b.action,
      kind: b.kind ?? null,
      amount: b.amount ?? null,
      reason: b.reason ?? null,
      source: b.source ?? 'dashboard',
      status: b.status,
      createdAtMs: b.createdAtMs,
      undoUntilMs: b.undoUntilMs,
      counts: b.counts ?? {},
    }));
}

export function assertChunkSize(items, max) {
  if (items.length > max) throw badRequest(`Send at most ${max} students per request.`, 'too_many_items');
}
