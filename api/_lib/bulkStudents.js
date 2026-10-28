import { FieldValue, Timestamp } from './firebaseAdmin.js';
import { postEntries, reverseEntries } from './ledger.js';
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
  // Since 003Fixes / 07 a chunk's ledger entries are one transaction
  // (postEntries), so fee work runs at the same 25 as everything else.
  blockFees: 25,
  unblock: 25,
  approveReceipts: 25,
  undo: 20,
  undoLedger: 25,
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
  // Per student, for the scheduled-block sweep (not returned to the browser).
  const outcomes = {};
  const skip = (why, item) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
    if (item) outcomes[itemId(item.session, item.phone)] = why;
  };
  const failed = [];
  let alreadyDone = 0;
  const toApply = [];

  list.forEach((item, i) => {
    if (itemSnaps[i]?.exists && itemSnaps[i].data().outcome === 'done') {
      alreadyDone += 1;
      outcomes[itemId(item.session, item.phone)] = 'done';
      return;
    }
    const snap = studentSnaps[i];
    if (!snap.exists) { skip('missing', item); return; }
    const data = snap.data();
    if (action === 'block') {
      if (effectiveApprovalStatus(data) === 'pending') { skip('awaitingApproval', item); return; }
      if (data.blocked === true) { skip('alreadyBlocked', item); return; }
    } else if (action === 'unblock') {
      if (data.blocked !== true) { skip('notBlocked', item); return; }
    } else if (action === 'approveReceipts') {
      if (!data.pendingReceipt) { skip('noReceipt', item); return; }
    }
    const account = accountSnaps[i];
    toApply.push({ ...item, data, balance: account?.exists ? (account.data().balance ?? 0) : (data.feeBalance ?? 0) });
  });

  // Ledger work first, all of the chunk in ONE transaction (postEntries): a
  // fee block's invoices, or an approval's payments. If it fails, none of
  // these students is touched (blocked with no balance to pay is a dead end).
  const ledgerWork = [];
  for (const item of toApply) {
    if (action === 'block' && kind === 'fees') {
      ledgerWork.push({ item, opts: {
        phone: item.phone, session: item.session, type: 'invoice', amount,
        note: 'Fees due — recorded when blocking', recordedBy,
        idempotencyKey: `bulk_${batch.id}_${itemId(item.session, item.phone)}`,
      } });
    } else if (action === 'approveReceipts' && feesEnabled && item.balance > 0) {
      ledgerWork.push({ item, opts: {
        phone: item.phone, session: item.session, type: 'payment', amount: item.balance, method: 'mpesa',
        reference: mpesaCodeFrom(item.data.pendingReceipt), note: 'Recorded on receipt approval (bulk)', recordedBy,
        sourceReceiptId: receiptIdFor(item.phone, item.data, nowMs),
        // Keyed by the batch, not the receipt: if this approval is undone,
        // approving the same receipt again later must post a fresh payment.
        idempotencyKey: `bulk_${batch.id}_${itemId(item.session, item.phone)}`,
      } });
    }
  }
  const entryFor = new Map();
  let ledgerFailed = null;
  if (ledgerWork.length) {
    try {
      const posted = await postEntries(ledgerWork.map((w) => w.opts));
      ledgerWork.forEach((w, k) => entryFor.set(w.item, posted[k]));
    } catch (err) {
      ledgerFailed = err?.code && typeof err.code === 'string' ? err.code : 'ledger_failed';
    }
  }
  const applied = [];
  for (const item of toApply) {
    const needsLedger = ledgerWork.some((w) => w.item === item);
    if (needsLedger && ledgerFailed) {
      failed.push({ index: item.index, code: ledgerFailed });
      outcomes[itemId(item.session, item.phone)] = 'failed';
      continue;
    }
    const posted = entryFor.get(item);
    applied.push({
      ...item,
      entryId: posted?.entryId ?? null,
      clearBlock: action === 'approveReceipts' && posted ? shouldAutoUnblock(posted.balance) : true,
    });
    outcomes[itemId(item.session, item.phone)] = 'done';
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
    outcomes,
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
  // One past the chunk, so a chunk that is exactly the rest knows it is the last.
  const itemsSnap = await ref.collection('items').where('outcome', '==', 'done').limit(limit + 1).get();
  const items = itemsSnap.docs.slice(0, limit).map((d) => ({ ref: d.ref, ...d.data() }));
  const studentSnaps = items.length ? await db.getAll(...items.map((i) => studentRef(db, i.session, i.phone))) : [];

  const tally = { undone: 0, changedSince: 0, missing: 0, failed: 0 };
  const outcome = items.map((item, i) => {
    if (!studentSnaps[i].exists) return 'missing';
    return stillAsLeft(batch.action, studentSnaps[i].data(), item) ? 'undone' : 'changedSince';
  });
  // Every entry to reverse, in one transaction.
  const toReverse = items.map((item, i) => ({ item, i })).filter(({ item, i }) => outcome[i] === 'undone' && item.entryId);
  if (toReverse.length) {
    try {
      const reversed = await reverseEntries(
        toReverse.map(({ item }) => ({ phone: item.phone, session: item.session, entryId: item.entryId })),
        { reason: 'Bulk action undone', recordedBy: user.uid }
      );
      reversed.forEach((r, k) => {
        if (r?.skipped && r.skipped !== 'already_reversed') outcome[toReverse[k].i] = 'failed';
      });
    } catch {
      for (const { i } of toReverse) outcome[i] = 'failed';
    }
  }
  const writes = db.batch();
  items.forEach((item, i) => {
    if (outcome[i] === 'undone') {
      writes.set(studentRef(db, item.session, item.phone), restoreFields(batch.action, item.before), { merge: true });
    }
    tally[outcome[i]] += 1;
    writes.update(item.ref, { outcome: outcome[i], undoneAtMs: nowMs });
  });

  const remaining = itemsSnap.docs.length > limit;
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

/**
 * The students a bulk action actually changed (outcome done), for the
 * teacher who made it — 003Fixes / 09, "Message these parents on WhatsApp".
 */
export async function listBatchItems({ db, user, batchId }) {
  const ref = batchRef(db, batchId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That bulk action was not found.', 'batch_not_found');
  if (snap.data().uid !== user.uid && user.role !== 'superadmin') {
    throw forbidden('That bulk action belongs to someone else.', 'batch_forbidden');
  }
  const items = await ref.collection('items').where('outcome', '==', 'done').limit(500).get();
  return items.docs.map((d) => ({ session: d.data().session, phone: d.data().phone }));
}
