import { getDb, FieldValue } from './firebaseAdmin.js';
import { assertIntegerKes, signedAmount } from './money.js';
import { badRequest, notFound } from './errors.js';

/**
 * The fee ledger — Phase 06 D2.
 *
 * APPEND-ONLY. Entries are never updated and never deleted. A mistake is
 * corrected by a `reversal` entry that references the original.
 *
 * This is the only defensible model for money. It survives a dispute — you can
 * show a parent every event in order, including the correction and who made it
 * — and it means the audit trail IS the data, rather than a parallel copy that
 * can drift from it. Mutable balances cannot answer "what did it say last
 * Tuesday, and who changed it?"
 *
 * Paths (mirroring the billing/* layout from Phase 03, so the codebase has one
 * convention rather than two):
 *
 *   fees/config                                     teacher's fee settings
 *   fees/accounts/items/{phone}                     denormalised account summary
 *   fees/accounts/items/{phone}/ledger/{entryId}    the append-only entries
 *   fees/invoices/items/{invoiceId}                 issued invoices
 *   fees/counters/items/{name}                      transactional sequences
 */

export const ENTRY_TYPES = ['invoice', 'payment', 'adjustment', 'reversal'];
export const PAYMENT_METHODS = ['cash', 'mpesa', 'bank', 'platform'];

export const accountRef = (db, phone) => db.doc(`fees/accounts/items/${phone}`);
export const ledgerRef = (db, phone) => accountRef(db, phone).collection('ledger');
export const invoiceRef = (db, id) => db.doc(`fees/invoices/items/${id}`);
export const counterRef = (db, name) => db.doc(`fees/counters/items/${name}`);

/**
 * Posts one entry.
 *
 * Everything below happens inside a SINGLE Firestore transaction:
 *
 *   1. read the current balance
 *   2. append the entry with `balanceAfter` computed inside the transaction
 *   3. write the new balance on the account
 *   4. update the denormalised summary on the student document
 *   5. increment the dashboard aggregates
 *
 * All five, or none. Two concurrent postings cannot interleave and produce a
 * balance that reflects only one of them — which is the failure mode that makes
 * a ledger untrustworthy, and the reason `FieldValue.increment` alone is not
 * enough here: we need to READ the balance to stamp `balanceAfter`, and a read
 * outside a transaction is already stale by the time we write.
 *
 * @param {object} opts
 * @param {string} opts.phone
 * @param {string} opts.session       needed to update the student document
 * @param {string} opts.type          invoice | payment | adjustment | reversal
 * @param {number} opts.amount        POSITIVE magnitude in whole KES
 * @param {string} [opts.method]      cash | mpesa | bank | platform
 * @param {string} [opts.reference]   M-Pesa receipt, bank slip, etc.
 * @param {string} [opts.note]
 * @param {Date}   [opts.occurredAt]  when the money actually moved
 * @param {string} opts.recordedBy    uid, or 'system:<job>'
 * @param {string} [opts.reversesEntryId]
 * @param {string} [opts.sourceReceiptId]
 * @param {string} [opts.idempotencyKey] entry ID; a replay collides and is dropped
 * @param {number} [opts.deltaOverride] signed delta, for reversals only
 */
export async function postEntry(opts) {
  const db = getDb();

  const {
    phone,
    session,
    type,
    amount,
    method = null,
    reference = null,
    note = null,
    occurredAt = null,
    recordedBy,
    reversesEntryId = null,
    sourceReceiptId = null,
    idempotencyKey = null,
    deltaOverride = null,
  } = opts;

  if (!ENTRY_TYPES.includes(type)) throw badRequest(`Unknown entry type: ${type}`);
  if (method !== null && !PAYMENT_METHODS.includes(method)) {
    throw badRequest(`Unknown payment method: ${method}`);
  }
  assertIntegerKes(amount, 'amount');
  if (amount <= 0) throw badRequest('Amount must be greater than zero.');

  const account = accountRef(db, phone);
  const entries = ledgerRef(db, phone);
  const entry = idempotencyKey ? entries.doc(idempotencyKey) : entries.doc();
  const studentDoc = db.doc(`sessions/${session}/students/${phone}`);
  const aggregates = db.doc('aggregates/dashboard');

  return db.runTransaction(async (tx) => {
    // ---- All reads must precede all writes in a Firestore transaction.
    const [accountSnap, entrySnap, studentSnap] = await Promise.all([
      tx.get(account),
      tx.get(entry),
      tx.get(studentDoc),
    ]);

    // Idempotency: a replayed Daraja callback or a double-clicked button must
    // not post twice.
    if (entrySnap.exists) {
      return {
        duplicate: true,
        entryId: entry.id,
        balance: accountSnap.exists ? (accountSnap.data().balance ?? 0) : 0,
      };
    }

    const previousBalance = accountSnap.exists ? (accountSnap.data().balance ?? 0) : 0;

    // A reversal's direction depends on what it reverses — undoing an invoice
    // must DECREASE the balance while undoing a payment must increase it — so
    // its delta is supplied rather than derived from the entry type.
    const delta = deltaOverride !== null ? deltaOverride : signedAmount(type, amount);
    const balanceAfter = previousBalance + delta;

    const now = FieldValue.serverTimestamp();
    const when = occurredAt ?? new Date();

    // ---- 1. The entry. Immutable from this moment.
    tx.set(entry, {
      type,
      amount: delta,
      magnitude: amount,
      method,
      reference,
      note,
      occurredAt: when,
      recordedAt: now,
      recordedBy,
      balanceAfter,
      reversesEntryId,
      sourceReceiptId,
      session,
      phone,
    });

    // ---- 2. The authoritative balance.
    tx.set(
      account,
      {
        phone,
        session,
        balance: balanceAfter,
        lastEntryAt: now,
        ...(type === 'payment' ? { lastPaymentAt: when, lastPaymentAmount: amount } : {}),
        updatedAt: now,
      },
      { merge: true }
    );

    // ---- 3. The denormalised copy the dashboard and the blocked screen read.
    //         Kept in the same transaction so it can never disagree with the
    //         ledger — a stale feeBalance is what produces "Balance of KES 0
    //         not paid" on a blocked student's screen.
    if (studentSnap.exists) {
      tx.set(
        studentDoc,
        {
          feeBalance: balanceAfter,
          ...(type === 'payment' ? { lastPaymentAt: when } : {}),
          // Paying up clears the overdue flag immediately rather than waiting
          // for the nightly sweep.
          ...(balanceAfter <= 0 ? { overdue: false } : {}),
        },
        { merge: true }
      );
    }

    // ---- 4. Aggregates, so the KPI cards cost one document read regardless of
    //         how many students there are.
    tx.set(
      aggregates,
      {
        totalOutstanding: FieldValue.increment(delta),
        ...(type === 'payment' ? { collectedThisMonth: FieldValue.increment(amount) } : {}),
        updatedAt: now,
      },
      { merge: true }
    );

    return { duplicate: false, entryId: entry.id, balance: balanceAfter, previousBalance };
  });
}

/**
 * Reverses an existing entry.
 *
 * Does NOT delete or edit the original — it posts an opposing entry that points
 * back at it. Both remain visible in the statement, which is what a parent
 * disputing a charge needs to see.
 */
export async function reverseEntry({ phone, session, entryId, reason, recordedBy }) {
  const db = getDb();
  const original = await ledgerRef(db, phone).doc(entryId).get();

  if (!original.exists) throw notFound('That ledger entry does not exist.');

  const data = original.data();
  if (data.type === 'reversal') {
    throw badRequest('That entry is itself a reversal and cannot be reversed again.', 'already_reversal');
  }
  if (data.reversedByEntryId) {
    throw badRequest('That entry has already been reversed.', 'already_reversed');
  }

  // The reversal's delta is the exact negation of the original's, so the
  // balance returns to precisely where it was — whatever the original was.
  // Deriving it from the entry TYPE would be wrong: reversing an invoice must
  // decrease the balance, and `LEDGER_SIGN.reversal` cannot know that.
  const result = await postEntry({
    phone,
    session,
    type: 'reversal',
    amount: Math.abs(data.amount),
    deltaOverride: -data.amount,
    method: data.method ?? null,
    note: reason,
    reversesEntryId: entryId,
    recordedBy,
  });

  // Mark the original so it cannot be reversed twice. This is the ONE field
  // ever written to an existing entry, and it is a pointer rather than a
  // restatement of any money value — the amounts stay immutable.
  if (!result.duplicate) {
    await ledgerRef(db, phone).doc(entryId).update({ reversedByEntryId: result.entryId });
  }

  return result;
}

/**
 * Transactional sequence. Never `count() + 1`, which races: two invoices
 * generated in the same second would both read N and both write N+1.
 */
export async function nextSequence(tx, db, name) {
  const ref = counterRef(db, name);
  const snap = await tx.get(ref);
  const next = (snap.exists ? (snap.data().value ?? 0) : 0) + 1;
  tx.set(ref, { value: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return next;
}

export function formatInvoiceNumber(prefix, year, sequence) {
  return `${prefix || 'INV'}-${year}-${String(sequence).padStart(4, '0')}`;
}
