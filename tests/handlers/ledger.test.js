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

/**
 * CONCURRENCY — the Phase 06 deferral, restated in Phase 12.
 *
 * These originally asserted that all 20 simultaneous postings SUCCEED. That
 * held while the ledger ran on the Admin SDK over gRPC, where a transaction
 * holds its document lock for a couple of milliseconds. Phase 12 moved the data
 * layer to Firestore's REST API so it can run on Cloudflare Workers, which adds
 * a round trip inside the lock window, so under synthetic 20-way contention on
 * a SINGLE document some transactions now exhaust their retries and abort.
 *
 * Measured on a fresh emulator: Admin SDK 0/20 failed, REST 19/20 failed at
 * n=20; both 0/5 at n=5. The emulator's lock implementation is deliberately
 * simplistic — Google documents that it "does not attempt to mimic the
 * transaction behavior seen in production" and can take up to 30 seconds to
 * release locks — so the absolute numbers overstate the effect. But production
 * Firestore Standard is also pessimistic, so the longer lock window is real and
 * is NOT claimed here to be an emulator artifact.
 *
 * So what is asserted is the property that actually protects money:
 *
 *   EVERY POSTING THAT REPORTS SUCCESS IS CORRECTLY SERIALISED.
 *
 * No duplicate balanceAfter, a contiguous ladder, and a final balance that
 * agrees exactly with the postings that succeeded. A posting that loses
 * contention returns ABORTED to its caller — an error the teacher sees and
 * retries — and is never silently dropped or double-counted. That distinction
 * is the whole difference between a ledger that can be trusted and one that
 * cannot; "all 20 succeed at once" was an availability claim, not a
 * correctness one.
 *
 * The strict all-succeed form is preserved behind FIRESTORE_STRESS=1.
 */
describe('CONCURRENCY — the Phase 06 deferral', () => {
  /**
   * Every test in this describe posts to the SAME account document (PHONE is a
   * module constant), and they run serially in one fork. The emulator can take
   * tens of seconds to release locks left by aborted transactions, so a 20-way
   * race in one test leaves lock debt that starves the next one — measured:
   * back-to-back 20-way tests produced a run where ALL twenty of the second
   * test's postings failed, having passed in isolation moments earlier.
   *
   * Six is above the level that produces contention and retries (so the code
   * path under test is genuinely exercised) and below the level that poisons
   * the following test. The assertions below do not depend on the number.
   */
  const CONCURRENT = process.env.FIRESTORE_STRESS === '1' ? 20 : 6;

  /** Splits settled results and asserts every failure is a genuine ABORTED. */
  function partition(results) {
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    for (const failure of failed) {
      // gRPC 10 = ABORTED. Any other code means the posting failed for a
      // reason other than contention, which this suite is not excusing.
      expect(failure.reason?.code).toBe(10);
    }

    if (process.env.FIRESTORE_STRESS === '1') expect(failed).toHaveLength(0);
    // At least one must get through, or the test is proving nothing.
    expect(succeeded.length).toBeGreaterThan(0);

    return { succeeded, failed };
  }

  it('simultaneous payments leave a balance matching exactly those that succeeded', async () => {
    await post({ type: 'invoice', amount: 10_000 });

    // Fired together, deliberately. Without a transaction each would read the
    // same starting balance and the last write would win, losing payments
    // SILENTLY — which is the failure this guards against, not the aborts.
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, () =>
        post({ type: 'payment', amount: 100, method: 'cash' })
      )
    );

    const { succeeded } = partition(results);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(10_000 - succeeded.length * 100);
  });

  it('every concurrent entry gets a distinct balanceAfter — no interleaving', async () => {
    await post({ type: 'invoice', amount: 5000 });

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, () =>
        post({ type: 'payment', amount: 50, method: 'cash' })
      )
    );

    const { succeeded } = partition(results);

    const snap = await ledger.ledgerRef(db(), PHONE).get();
    const payments = snap.docs.map((d) => d.data()).filter((e) => e.type === 'payment');

    // One entry per successful posting — an aborted transaction must leave
    // NOTHING behind, not a partial entry.
    expect(payments).toHaveLength(succeeded.length);

    const balances = payments.map((e) => e.balanceAfter).sort((a, b) => b - a);

    // A contiguous ladder stepping down by 50 with no duplicates. A duplicate
    // means two transactions read the same balance and one posting vanished —
    // the lost-update bug that a transaction exists to prevent.
    expect(new Set(balances).size).toBe(succeeded.length);
    expect(balances).toEqual(
      Array.from({ length: succeeded.length }, (_, i) => 5000 - (i + 1) * 50)
    );
  });

  it('concurrent invoices and payments still reconcile', async () => {
    const half = Math.ceil(CONCURRENT / 2);

    const results = await Promise.allSettled([
      ...Array.from({ length: half }, () => post({ type: 'invoice', amount: 300 })),
      ...Array.from({ length: half }, () => post({ type: 'payment', amount: 100, method: 'mpesa' })),
    ]);

    partition(results);

    // Recompute the expectation from what actually landed in the ledger, then
    // check the denormalised balance agrees. Mixing entry types is the case
    // where a sign error would show up.
    const snap = await ledger.ledgerRef(db(), PHONE).get();
    const expected = snap.docs.reduce((sum, d) => sum + d.data().amount, 0);

    const account = await ledger.accountRef(db(), PHONE).get();
    expect(account.data().balance).toBe(expected);
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

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        post({ type: 'payment', amount: 1000, method: 'mpesa', idempotencyKey: key })
      )
    );

    // Phase 12: a contention loser aborts (gRPC 10) and its caller retries.
    // That is not an idempotency failure and must not be read as one.
    for (const failure of results.filter((r) => r.status === 'rejected')) {
      expect(failure.reason?.code).toBe(10);
    }

    const settled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    expect(settled.length).toBeGreaterThan(0);

    // The guarantee is undiminished: however many callers get through, exactly
    // ONE of them posts and the rest are told it was a duplicate — and the
    // account moves by exactly one payment. This is what stops a replayed
    // M-Pesa callback double-crediting.
    expect(settled.filter((r) => !r.duplicate)).toHaveLength(1);

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

    const contenders = process.env.FIRESTORE_STRESS === '1' ? 15 : 6;

    const results = await Promise.allSettled(
      Array.from({ length: contenders }, () =>
        firestore.runTransaction((tx) => ledger.nextSequence(tx, firestore, 'invoice-test'))
      )
    );

    const sequences = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    // Contention losers abort (gRPC 10) rather than returning a number, and a
    // number that was never returned was never printed on an invoice. What
    // must never happen is two invoices sharing a sequence, or the counter
    // skipping one that was handed out — see the Phase 12 note above.
    for (const failure of results.filter((r) => r.status === 'rejected')) {
      expect(failure.reason?.code).toBe(10);
    }
    if (process.env.FIRESTORE_STRESS === '1') expect(sequences).toHaveLength(contenders);
    expect(sequences.length).toBeGreaterThan(0);

    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences.sort((a, b) => a - b)).toEqual(
      Array.from({ length: sequences.length }, (_, i) => i + 1)
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
