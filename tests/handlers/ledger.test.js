import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Ledger integration tests — Phase 11 D1, closing a Phase 06 deferral.
 *
 * Phase 06 shipped the ledger with the note that "20 concurrent postings
 * produce a correct final balance" was **verified by reading, not by
 * execution**, because proving it needs the Admin SDK against a real emulator.
 * This is that harness.
 *
 * These are the highest-value tests in the programme after the subscription
 * state machine: they are the only ones that exercise a real Firestore
 * transaction under contention, which is exactly where a ledger silently goes
 * wrong.
 */

let ledger;
let db;

beforeAll(async () => {
  // Points the Admin SDK at the emulator started by `firebase emulators:exec`.
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT ??= 'demo-online-tutoring';
  // Set before the SDK loads, so the metadata-server probe never starts.
  process.env.METADATA_SERVER_DETECTION ??= 'none';
  process.env.GCE_METADATA_HOST ??= '0.0.0.0';

  ledger = await import('../../api/_lib/ledger.js');
  ({ getDb: db } = await import('../../api/_lib/firebaseAdmin.js'));
});

const PHONE = '+254712345678';
const SESSION = 'morning';

async function wipe() {
  const firestore = db();
  const paths = [
    `fees/accounts/items/${PHONE}`,
    `sessions/${SESSION}/students/${PHONE}`,
    'aggregates/dashboard',
  ];

  const entries = await ledger.ledgerRef(firestore, PHONE).get();
  await Promise.all(entries.docs.map((d) => d.ref.delete()));
  await Promise.all(paths.map((p) => firestore.doc(p).delete()));

  await firestore.doc(`sessions/${SESSION}/students/${PHONE}`).set({
    studentName: 'Amina Wanjiru',
    parentPhone: PHONE,
    class: 'Grade 8',
    blocked: false,
    approvalStatus: 'approved',
    feeBalance: 0,
  });
}

beforeEach(wipe);

const post = (overrides) =>
  ledger.postEntry({
    phone: PHONE,
    session: SESSION,
    recordedBy: 'test',
    ...overrides,
  });

describe('sequential postings', () => {
  it('an invoice increases the balance and a payment decreases it', async () => {
    const invoiced = await post({ type: 'invoice', amount: 3000 });
    expect(invoiced.balance).toBe(3000);

    const paid = await post({ type: 'payment', amount: 1000, method: 'cash' });
    expect(paid.balance).toBe(2000);
  });

  it('stamps balanceAfter on each entry, in order', async () => {
    await post({ type: 'invoice', amount: 3000 });
    await post({ type: 'payment', amount: 1000, method: 'mpesa' });
    await post({ type: 'payment', amount: 500, method: 'cash' });

    const snap = await ledger.ledgerRef(db(), PHONE).orderBy('recordedAt').get();
    expect(snap.docs.map((d) => d.data().balanceAfter)).toEqual([3000, 2000, 1500]);
  });

  it('denormalises the balance onto the student document in the same transaction', async () => {
    await post({ type: 'invoice', amount: 3000 });
    const student = await db().doc(`sessions/${SESSION}/students/${PHONE}`).get();
    // A stale feeBalance is what produces "Balance of KES 0 not paid" on a
    // blocked student's screen.
    expect(student.data().feeBalance).toBe(3000);
  });
});

describe('CONCURRENCY — the Phase 06 deferral', () => {
  it('20 simultaneous payments produce a correct final balance', async () => {
    await post({ type: 'invoice', amount: 10_000 });

    // Fired together, deliberately. Without a transaction each would read the
    // same starting balance and the last write would win, losing 19 payments.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        post({ type: 'payment', amount: 100, method: 'cash' })
      )
    );

    expect(results).toHaveLength(20);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(10_000 - 20 * 100);
  });

  it('every concurrent entry gets a distinct balanceAfter — no interleaving', async () => {
    await post({ type: 'invoice', amount: 5000 });

    await Promise.all(
      Array.from({ length: 20 }, () => post({ type: 'payment', amount: 50, method: 'cash' }))
    );

    const snap = await ledger.ledgerRef(db(), PHONE).get();
    const payments = snap.docs.map((d) => d.data()).filter((e) => e.type === 'payment');

    const balances = payments.map((e) => e.balanceAfter).sort((a, b) => b - a);
    // 4950, 4900, … 4000 — a contiguous ladder with no duplicates. A duplicate
    // means two transactions read the same balance and one posting vanished.
    expect(new Set(balances).size).toBe(20);
    expect(balances[0]).toBe(4950);
    expect(balances[19]).toBe(4000);
  });

  it('concurrent invoices and payments still reconcile', async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, () => post({ type: 'invoice', amount: 300 })),
      ...Array.from({ length: 10 }, () => post({ type: 'payment', amount: 100, method: 'mpesa' })),
    ]);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(10 * 300 - 10 * 100);
  });
});

describe('idempotency', () => {
  it('the same idempotency key posts exactly once', async () => {
    // This is what stops a replayed M-Pesa callback double-crediting.
    const key = 'mpesa_ws_CO_TEST123';

    const first = await post({ type: 'payment', amount: 1500, method: 'mpesa', idempotencyKey: key });
    const second = await post({ type: 'payment', amount: 1500, method: 'mpesa', idempotencyKey: key });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(-1500);
  });

  it('survives the same key fired concurrently', async () => {
    const key = 'mpesa_ws_CO_RACE';

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        post({ type: 'payment', amount: 1000, method: 'mpesa', idempotencyKey: key })
      )
    );

    const posted = results.filter((r) => !r.duplicate);
    expect(posted).toHaveLength(1);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(-1000);
  });
});

describe('reversals', () => {
  it('reversing a PAYMENT increases the balance back', async () => {
    await post({ type: 'invoice', amount: 3000 });
    const payment = await post({ type: 'payment', amount: 1000, method: 'cash' });
    expect(payment.balance).toBe(2000);

    await ledger.reverseEntry({
      phone: PHONE,
      session: SESSION,
      entryId: payment.entryId,
      reason: 'Recorded against the wrong student',
      recordedBy: 'test',
    });

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(3000);
  });

  it('reversing an INVOICE decreases the balance', async () => {
    // The Phase 06 sign bug: LEDGER_SIGN.reversal is +1, which is correct for
    // undoing a payment and WRONG for undoing a charge. Reversals carry an
    // explicit delta of -original.amount instead.
    const invoice = await post({ type: 'invoice', amount: 3000 });
    expect(invoice.balance).toBe(3000);

    await ledger.reverseEntry({
      phone: PHONE,
      session: SESSION,
      entryId: invoice.entryId,
      reason: 'Invoiced in error',
      recordedBy: 'test',
    });

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(0);
  });

  it('restores the prior balance exactly, whatever it was', async () => {
    await post({ type: 'invoice', amount: 3000 });
    await post({ type: 'payment', amount: 750, method: 'cash' });
    const target = await post({ type: 'payment', amount: 1234, method: 'mpesa' });
    const before = 3000 - 750;

    await ledger.reverseEntry({
      phone: PHONE,
      session: SESSION,
      entryId: target.entryId,
      reason: 'Duplicate',
      recordedBy: 'test',
    });

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(before);
  });

  it('refuses to reverse the same entry twice', async () => {
    const payment = await post({ type: 'payment', amount: 500, method: 'cash' });

    await ledger.reverseEntry({
      phone: PHONE, session: SESSION, entryId: payment.entryId,
      reason: 'First', recordedBy: 'test',
    });

    await expect(
      ledger.reverseEntry({
        phone: PHONE, session: SESSION, entryId: payment.entryId,
        reason: 'Second', recordedBy: 'test',
      })
    ).rejects.toThrow();
  });

  it('refuses to reverse a reversal', async () => {
    const payment = await post({ type: 'payment', amount: 500, method: 'cash' });
    const reversal = await ledger.reverseEntry({
      phone: PHONE, session: SESSION, entryId: payment.entryId,
      reason: 'Mistake', recordedBy: 'test',
    });

    await expect(
      ledger.reverseEntry({
        phone: PHONE, session: SESSION, entryId: reversal.entryId,
        reason: 'Undo the undo', recordedBy: 'test',
      })
    ).rejects.toThrow();
  });
});

describe('invoice numbering', () => {
  it('a transactional counter produces no gaps or duplicates under contention', async () => {
    // Never count() + 1: two invoices in the same second would both read N and
    // both write N+1, producing a duplicate number an accountant notices and
    // nobody can explain.
    const firestore = db();
    await ledger.counterRef(firestore, 'invoice-test').delete();

    const sequences = await Promise.all(
      Array.from({ length: 15 }, () =>
        firestore.runTransaction((tx) => ledger.nextSequence(tx, firestore, 'invoice-test'))
      )
    );

    expect(new Set(sequences).size).toBe(15);
    expect(sequences.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1)
    );
  });
});

describe('input validation', () => {
  it('rejects a fractional amount', async () => {
    await expect(post({ type: 'payment', amount: 100.5, method: 'cash' })).rejects.toThrow();
  });

  it('rejects a zero or negative amount', async () => {
    await expect(post({ type: 'payment', amount: 0, method: 'cash' })).rejects.toThrow();
    await expect(post({ type: 'payment', amount: -100, method: 'cash' })).rejects.toThrow();
  });

  it('rejects an unknown entry type', async () => {
    await expect(post({ type: 'refund', amount: 100 })).rejects.toThrow();
  });

  it('rejects an unknown payment method', async () => {
    await expect(post({ type: 'payment', amount: 100, method: 'crypto' })).rejects.toThrow();
  });
});
