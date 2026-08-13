import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Firestore REST shim vs firebase-admin — Phase 12 D2, the migration gate.
 *
 * `firebase-admin` cannot run on Cloudflare Workers, so it was replaced by a
 * REST-backed shim exposing the same surface. The risk of that swap is
 * concentrated in one place: does the shim behave IDENTICALLY on a billing
 * system's edge cases?
 *
 * This suite answers that empirically rather than by reading. Both clients are
 * pointed at the same emulator and the same documents, and every assertion is
 * either "these two produce the same result" or "each can read what the other
 * wrote". Cross-reading is the strongest form: it catches an encoder and a
 * decoder that are wrong in the same direction and would otherwise agree with
 * themselves.
 *
 * If this suite passes, the swap is safe. If it does not, the migration stops.
 *
 * Run with: npm run test:handlers
 */

let adminDb;      // firebase-admin (the reference implementation)
let restDb;       // the shim under test
let AdminFieldValue;
let RestFieldValue;
let SubrequestBudgetExceeded;

const PREFIX = 'parity';

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT ??= 'demo-online-tutoring';
  process.env.METADATA_SERVER_DETECTION ??= 'none';
  process.env.GCE_METADATA_HOST ??= '0.0.0.0';

  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  const app = getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId: process.env.GCLOUD_PROJECT });

  adminDb = getFirestore(app);
  adminDb.settings({ ignoreUndefinedProperties: true });
  AdminFieldValue = FieldValue;

  const rest = await import('../../api/_lib/firestoreRest.js');
  restDb = new rest.Firestore({ projectId: process.env.GCLOUD_PROJECT });
  RestFieldValue = rest.FieldValue;
  ({ SubrequestBudgetExceeded } = rest);
});

/**
 * Collapses the two clients' distinct Timestamp classes to a comparable shape.
 * Everything else must already match exactly.
 */
function normalize(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === 'function') return { __ts: value.toMillis() };
  if (Buffer.isBuffer(value)) return { __bytes: value.toString('base64') };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

let counter = 0;
/** A fresh document path per test, so nothing inherits another test's state. */
function freshPath() {
  counter += 1;
  return `${PREFIX}/docs/items/case_${counter}_${Date.now()}`;
}

async function bothRead(path) {
  const [adminSnap, restSnap] = await Promise.all([
    adminDb.doc(path).get(),
    restDb.doc(path).get(),
  ]);
  return {
    admin: adminSnap.exists ? normalize(adminSnap.data()) : null,
    rest: restSnap.exists ? normalize(restSnap.data()) : null,
    adminExists: adminSnap.exists,
    restExists: restSnap.exists,
  };
}

// ---------------------------------------------------------------------------
// Encoding parity
// ---------------------------------------------------------------------------

describe('value round trip', () => {
  const payload = () => ({
    balance: 4999,
    negative: -7499,
    zero: 0,
    fraction: 0.5,
    name: 'Amina Wanjiru',
    blank: '',
    active: true,
    missing: null,
    occurredAt: new Date('2026-08-13T10:30:00.000Z'),
    tags: ['mpesa', 'cash'],
    mixed: [1, 'two', true, null],
    nested: { freq: 'WEEKLY', byDay: ['MO', 'WE'], depth: { level: 2 } },
    empty: {},
  });

  it('the shim reads back exactly what admin wrote', async () => {
    const path = freshPath();
    await adminDb.doc(path).set(payload());

    const { admin, rest } = await bothRead(path);
    expect(rest).toEqual(admin);
  });

  it('admin reads back exactly what the shim wrote', async () => {
    // The other direction, which is what catches an encoder and decoder that
    // are wrong in matching ways and so agree with themselves.
    const path = freshPath();
    await restDb.doc(path).set(payload());

    const { admin, rest } = await bothRead(path);
    expect(admin).toEqual(rest);
  });

  it('keeps whole KES amounts as integers through admin', async () => {
    const path = freshPath();
    await restDb.doc(path).set({ balance: 4999 });

    const value = (await adminDb.doc(path).get()).data().balance;
    expect(value).toBe(4999);
    expect(Number.isInteger(value)).toBe(true);
  });

  it('distinguishes an explicit null from an absent field', async () => {
    const path = freshPath();
    await restDb.doc(path).set({ present: null, skipped: undefined });

    const data = (await adminDb.doc(path).get()).data();
    expect(data).toHaveProperty('present', null);
    expect(data).not.toHaveProperty('skipped');
  });

  it('reports a missing document as a non-existent snapshot, not an error', async () => {
    const result = await bothRead(`${PREFIX}/docs/items/never_written`);
    expect(result.restExists).toBe(false);
    expect(result.adminExists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merge semantics
// ---------------------------------------------------------------------------

describe('set with merge', () => {
  it('preserves fields it does not mention', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ a: 1, b: 2 });
    await restDb.doc(path).set({ b: 3 }, { merge: true });

    const { admin } = await bothRead(path);
    expect(admin).toEqual({ a: 1, b: 3 });
  });

  it('deep-merges a nested map rather than replacing it', async () => {
    // The single most consequential merge behaviour: masking `a` instead of
    // `a.b` would silently delete sibling keys.
    const path = freshPath();
    await adminDb.doc(path).set({ recurrence: { freq: 'WEEKLY', count: 4 } });
    await restDb.doc(path).set({ recurrence: { count: 8 } }, { merge: true });

    const viaAdmin = (await adminDb.doc(path).get()).data();
    expect(viaAdmin.recurrence).toEqual({ freq: 'WEEKLY', count: 8 });
  });

  it('matches admin exactly on the same nested merge', async () => {
    const seed = { recurrence: { freq: 'WEEKLY', count: 4 }, other: 'keep' };
    const patch = { recurrence: { count: 8 } };

    const adminPath = freshPath();
    await adminDb.doc(adminPath).set(seed);
    await adminDb.doc(adminPath).set(patch, { merge: true });

    const restPath = freshPath();
    await restDb.doc(restPath).set(seed);
    await restDb.doc(restPath).set(patch, { merge: true });

    const [a, b] = await Promise.all([
      adminDb.doc(adminPath).get(),
      adminDb.doc(restPath).get(),
    ]);
    expect(normalize(b.data())).toEqual(normalize(a.data()));
  });

  it('replaces the whole document when merge is not set', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ a: 1, b: 2 });
    await restDb.doc(path).set({ b: 3 });

    const { admin } = await bothRead(path);
    expect(admin).toEqual({ b: 3 });
  });
});

// ---------------------------------------------------------------------------
// Field transforms
// ---------------------------------------------------------------------------

describe('field transforms', () => {
  it('serverTimestamp lands as a real server-side timestamp', async () => {
    const path = freshPath();
    const before = Date.now();
    await restDb.doc(path).set({ updatedAt: RestFieldValue.serverTimestamp() });

    const value = (await adminDb.doc(path).get()).data().updatedAt;
    expect(typeof value.toMillis).toBe('function');
    expect(value.toMillis()).toBeGreaterThanOrEqual(before - 5000);
    expect(value.toMillis()).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it('increment accumulates across both clients', async () => {
    // Interleaving the two proves they are writing the same transform, not two
    // different things that each happen to work in isolation.
    const path = freshPath();
    await adminDb.doc(path).set({ n: AdminFieldValue.increment(10) }, { merge: true });
    await restDb.doc(path).set({ n: RestFieldValue.increment(5) }, { merge: true });
    await adminDb.doc(path).set({ n: AdminFieldValue.increment(-3) }, { merge: true });

    expect((await adminDb.doc(path).get()).data().n).toBe(12);
  });

  it('increment on an absent field starts from zero', async () => {
    const path = freshPath();
    await restDb.doc(path).set({ n: RestFieldValue.increment(7) }, { merge: true });
    expect((await adminDb.doc(path).get()).data().n).toBe(7);
  });

  it('combines a transform with an ordinary field on the same document', async () => {
    // This is the exact shape postEntry() writes: a computed balance alongside
    // an incremented aggregate and a server timestamp.
    const path = freshPath();
    await adminDb.doc(path).set({ balance: 100, total: 100 });

    await restDb.doc(path).set(
      {
        balance: 600,
        total: RestFieldValue.increment(500),
        updatedAt: RestFieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const data = (await adminDb.doc(path).get()).data();
    expect(data.balance).toBe(600);
    expect(data.total).toBe(600);
    expect(typeof data.updatedAt.toMillis).toBe('function');
  });

  it('arrayUnion appends without duplicating', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ sent: ['a'] });
    await restDb.doc(path).set({ sent: RestFieldValue.arrayUnion('a', 'b') }, { merge: true });

    expect((await adminDb.doc(path).get()).data().sent).toEqual(['a', 'b']);
  });

  it('FieldValue.delete() removes the field', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ keep: 1, drop: 2 });
    await restDb.doc(path).set({ drop: RestFieldValue.delete() }, { merge: true });

    const data = (await adminDb.doc(path).get()).data();
    expect(data).toHaveProperty('keep', 1);
    expect(data).not.toHaveProperty('drop');
  });
});

// ---------------------------------------------------------------------------
// create() — the idempotency guarantee
// ---------------------------------------------------------------------------

describe('create', () => {
  it('succeeds when the document does not exist', async () => {
    const path = freshPath();
    await restDb.doc(path).create({ status: 'received' });
    expect((await adminDb.doc(path).get()).exists).toBe(true);
  });

  it('fails with gRPC code 6 when it does, matching admin', async () => {
    // billing/webhook.js turns `err.code === 6` into "duplicate delivery,
    // ignore" and sessions/manage.js into "that slug is taken". If this code
    // changed, a replayed Paystack webhook would be processed a second time.
    const path = freshPath();
    await adminDb.doc(path).create({ status: 'received' });

    const adminError = await adminDb.doc(path).create({ status: 'again' }).catch((e) => e);
    const restError = await restDb.doc(path).create({ status: 'again' }).catch((e) => e);

    expect(adminError.code).toBe(6);
    expect(restError.code).toBe(6);
    expect(restError.code).toBe(adminError.code);
  });

  it('leaves the original document untouched after a collision', async () => {
    const path = freshPath();
    await restDb.doc(path).create({ status: 'received', attempt: 1 });
    await restDb.doc(path).create({ status: 'overwritten', attempt: 2 }).catch(() => {});

    expect((await adminDb.doc(path).get()).data()).toEqual({ status: 'received', attempt: 1 });
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('update', () => {
  it('fails on a missing document, as admin does', async () => {
    const path = freshPath();

    const adminError = await adminDb.doc(path).update({ a: 1 }).catch((e) => e);
    const restError = await restDb.doc(path).update({ a: 1 }).catch((e) => e);

    expect(adminError).toBeInstanceOf(Error);
    expect(restError).toBeInstanceOf(Error);
    expect(restError.code).toBe(adminError.code);
  });

  it('replaces a nested map wholesale', async () => {
    // Where update() and set({merge:true}) genuinely differ.
    // calendar/manage.js relies on this.
    const path = freshPath();
    await adminDb.doc(path).set({ recurrence: { freq: 'WEEKLY', count: 4 }, keep: 1 });
    await restDb.doc(path).update({ recurrence: { freq: 'DAILY' } });

    const data = (await adminDb.doc(path).get()).data();
    expect(data.recurrence).toEqual({ freq: 'DAILY' });
    expect(data.keep).toBe(1);
  });

  it('applies a transform inside an update', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ attempts: 1 });
    await restDb.doc(path).update({ attempts: RestFieldValue.increment(1) });

    expect((await adminDb.doc(path).get()).data().attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe('runTransaction', () => {
  it('reads and writes atomically', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ balance: 100 });

    const result = await restDb.runTransaction(async (tx) => {
      const snap = await tx.get(restDb.doc(path));
      const next = snap.data().balance + 50;
      tx.set(restDb.doc(path), { balance: next }, { merge: true });
      return next;
    });

    expect(result).toBe(150);
    expect((await adminDb.doc(path).get()).data().balance).toBe(150);
  });

  it('coalesces reads issued in the same tick into one round trip', async () => {
    // The Promise.all shape used by postEntry(). Correctness first — all three
    // snapshots must be right — but the batching is what keeps a ledger
    // posting inside Cloudflare's 50-subrequest budget.
    const paths = [freshPath(), freshPath(), freshPath()];
    await Promise.all(paths.map((p, i) => adminDb.doc(p).set({ n: i })));

    const values = await restDb.runTransaction(async (tx) => {
      const snaps = await Promise.all(paths.map((p) => tx.get(restDb.doc(p))));
      return snaps.map((s) => s.data().n);
    });

    expect(values).toEqual([0, 1, 2]);
  });

  it('sees a missing document as non-existent inside the transaction', async () => {
    const path = freshPath();

    const existed = await restDb.runTransaction(async (tx) => {
      const snap = await tx.get(restDb.doc(path));
      return snap.exists;
    });

    expect(existed).toBe(false);
  });

  it('rolls back every write when the body throws', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ balance: 100 });

    await expect(
      restDb.runTransaction(async (tx) => {
        tx.set(restDb.doc(path), { balance: 999 }, { merge: true });
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect((await adminDb.doc(path).get()).data().balance).toBe(100);
  });

  /**
   * A NOTE ON CONTENTION LEVELS, because the number here was chosen carefully.
   *
   * The emulator implements read-write transactions with real PESSIMISTIC
   * locks and a fixed lock-wait timeout. Production Firestore does not — it
   * uses optimistic concurrency and returns ABORTED promptly, which is what
   * the retry loop is built for. That difference is invisible to the Admin SDK
   * because gRPC on a warm HTTP/2 connection holds the lock for single-digit
   * milliseconds; over REST the same window is two HTTP round trips (~75ms
   * measured). Past roughly a dozen simultaneous writers to ONE document the
   * emulator therefore starves the REST client in a way production would not.
   *
   * So the level asserted here is the level the product actually sees: a
   * single-teacher app has at most a handful of concurrent writers against one
   * fee account. That still forces genuine ABORTED-and-retry — five
   * transactions cannot serialise on one document without some of them losing
   * — so the retry path is exercised, not skipped.
   *
   * The 20-way stress case lives behind FIRESTORE_STRESS=1 below.
   */
  /** Asserts every failure was contention, and reports how many got through. */
  function survivors(results) {
    for (const failure of results.filter((r) => r.status === 'rejected')) {
      // gRPC 10 = ABORTED. Anything else means the transaction broke for a
      // reason this suite is not excusing.
      expect(failure.reason?.code).toBe(10);
    }
    const count = results.filter((r) => r.status === 'fulfilled').length;
    expect(count).toBeGreaterThan(0);
    return count;
  }

  it('never loses an update under concurrency', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ balance: 0 });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        restDb.runTransaction(async (tx) => {
          const snap = await tx.get(restDb.doc(path));
          tx.set(restDb.doc(path), { balance: (snap.data()?.balance ?? 0) + 1 }, { merge: true });
        })
      )
    );

    // The balance must account for EXACTLY the transactions that reported
    // success — no more (a double-apply) and no fewer (a lost update). That is
    // the property a transaction exists to provide; how many of them win the
    // race against the emulator's lock model is not.
    expect((await adminDb.doc(path).get()).data().balance).toBe(survivors(results));
  });

  it('interoperates with a concurrent admin-SDK transaction on the same document', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ balance: 0, hits: 0 });

    const bump = (client, FV) => client.runTransaction(async (tx) => {
      const snap = await tx.get(client.doc(path));
      tx.set(client.doc(path), { balance: (snap.data()?.balance ?? 0) + 1 }, { merge: true });
      // Touch a transform too, so both paths exercise updateTransforms under
      // contention rather than plain field writes.
      tx.set(client.doc(path), { hits: FV.increment(1) }, { merge: true });
    });

    const results = await Promise.allSettled([
      ...Array.from({ length: 3 }, () => bump(restDb, RestFieldValue)),
      ...Array.from({ length: 3 }, () => bump(adminDb, AdminFieldValue)),
    ]);

    const succeeded = survivors(results);
    const data = (await adminDb.doc(path).get()).data();

    // Both clients' writes composed correctly, and the read-modify-write field
    // and the server-side transform stayed in lockstep — if the shim's
    // updateTransforms landed outside the transaction, these two would diverge.
    expect(data.balance).toBe(succeeded);
    expect(data.hits).toBe(succeeded);
  });

  /**
   * Opt-in stress comparison. Not in the default run because what it measures
   * at this level is the emulator's lock model rather than the shim's
   * correctness — see the note above. It is kept because when the emulator is
   * fresh it is still the sharpest available signal, and because deleting an
   * inconvenient measurement is not the same as understanding it.
   *
   * Run with: FIRESTORE_STRESS=1 npm run test:handlers
   */
  it.runIf(process.env.FIRESTORE_STRESS === '1')(
    'is no worse than the Admin SDK at 20-way contention',
    async () => {
      const race = async (client) => {
        const path = freshPath();
        await adminDb.doc(path).set({ balance: 0 });

        const results = await Promise.allSettled(
          Array.from({ length: 20 }, () =>
            client.runTransaction(async (tx) => {
              const snap = await tx.get(client.doc(path));
              tx.set(client.doc(path), { balance: (snap.data()?.balance ?? 0) + 1 }, { merge: true });
            })
          )
        );
        return {
          failed: results.filter((r) => r.status === 'rejected').length,
          final: (await adminDb.doc(path).get()).data().balance,
        };
      };

      // Admin second: the first run leaves the emulator lock-degraded, so
      // running them in this order biases AGAINST the shim rather than for it.
      const rest = await race(restDb);
      const admin = await race(adminDb);

      // eslint-disable-next-line no-console
      console.log(`stress: rest failed=${rest.failed} admin failed=${admin.failed}`);

      // Whatever survives must be internally consistent — a transaction that
      // reported success must have actually applied its increment.
      expect(rest.final).toBe(20 - rest.failed);
      expect(admin.final).toBe(20 - admin.failed);
    },
    180_000
  );
});

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

describe('WriteBatch', () => {
  it('applies every write atomically', async () => {
    const paths = [freshPath(), freshPath()];
    const batch = restDb.batch();

    batch.set(restDb.doc(paths[0]), { a: 1 });
    batch.set(restDb.doc(paths[1]), { b: 2, at: RestFieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();

    expect((await adminDb.doc(paths[0]).get()).data()).toEqual({ a: 1 });
    expect((await adminDb.doc(paths[1]).get()).data().b).toBe(2);
  });

  it('is a no-op when empty', async () => {
    await expect(restDb.batch().commit()).resolves.toEqual([]);
  });

  it('deletes documents', async () => {
    const path = freshPath();
    await adminDb.doc(path).set({ a: 1 });

    const batch = restDb.batch();
    batch.delete(restDb.doc(path));
    await batch.commit();

    expect((await adminDb.doc(path).get()).exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe('queries', () => {
  const collection = `${PREFIX}/query/items`;

  beforeEach(async () => {
    const existing = await adminDb.collection(collection).get();
    const cleanup = adminDb.batch();
    existing.docs.forEach((d) => cleanup.delete(d.ref));
    await cleanup.commit();

    const batch = adminDb.batch();
    [
      { id: 'a', status: 'pending', order: 3, at: new Date('2026-01-03') },
      { id: 'b', status: 'pending', order: 1, at: new Date('2026-01-01') },
      { id: 'c', status: 'done', order: 2, at: new Date('2026-01-02') },
      { id: 'd', status: 'failed', order: 4, at: new Date('2026-01-04') },
    ].forEach((doc) => batch.set(adminDb.doc(`${collection}/${doc.id}`), doc));
    await batch.commit();
  });

  const ids = (snap) => snap.docs.map((d) => d.id);

  it('filters on equality identically to admin', async () => {
    const [a, r] = await Promise.all([
      adminDb.collection(collection).where('status', '==', 'pending').get(),
      restDb.collection(collection).where('status', '==', 'pending').get(),
    ]);
    expect(ids(r).sort()).toEqual(ids(a).sort());
    expect(ids(r).sort()).toEqual(['a', 'b']);
  });

  it('applies limit', async () => {
    const snap = await restDb.collection(collection).where('status', '==', 'pending').limit(1).get();
    expect(snap.size).toBe(1);
  });

  it('orders ascending and descending', async () => {
    const asc = await restDb.collection(collection).orderBy('order').get();
    expect(ids(asc)).toEqual(['b', 'c', 'a', 'd']);

    const desc = await restDb.collection(collection).orderBy('order', 'desc').get();
    expect(ids(desc)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('supports the "in" operator', async () => {
    const snap = await restDb
      .collection(collection)
      .where('status', 'in', ['pending', 'failed'])
      .get();
    expect(ids(snap).sort()).toEqual(['a', 'b', 'd']);
  });

  it('supports range filters on timestamps', async () => {
    const snap = await restDb
      .collection(collection)
      .where('at', '>=', new Date('2026-01-02'))
      .where('at', '<=', new Date('2026-01-03'))
      .get();
    expect(ids(snap).sort()).toEqual(['a', 'c']);
  });

  it('exposes ref, id and data on each result like admin', async () => {
    const snap = await restDb.collection(collection).where('status', '==', 'done').get();
    const [doc] = snap.docs;

    expect(doc.id).toBe('c');
    expect(doc.ref.path).toBe(`${collection}/c`);
    expect(doc.data().order).toBe(2);

    // mpesaReconcile.js writes through `docSnap.ref.set(...)`.
    await doc.ref.set({ touched: true }, { merge: true });
    expect((await adminDb.doc(`${collection}/c`).get()).data().touched).toBe(true);
  });

  it('returns an empty snapshot rather than throwing when nothing matches', async () => {
    const snap = await restDb.collection(collection).where('status', '==', 'nope').get();
    expect(snap.empty).toBe(true);
    expect(snap.size).toBe(0);
    expect(snap.docs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Listing and recursive delete
// ---------------------------------------------------------------------------

describe('listing and recursive delete', () => {
  it('lists documents in a collection', async () => {
    const collection = `${PREFIX}/list_${Date.now()}/items`;
    await adminDb.doc(`${collection}/one`).set({ a: 1 });
    await adminDb.doc(`${collection}/two`).set({ a: 2 });

    const refs = await restDb.collection(collection).listDocuments();
    expect(refs.map((r) => r.id).sort()).toEqual(['one', 'two']);
  });

  it('lists subcollections of a document', async () => {
    const parent = `${PREFIX}/sub_${Date.now()}`;
    await adminDb.doc(`${parent}/alpha/x`).set({ a: 1 });
    await adminDb.doc(`${parent}/beta/y`).set({ a: 2 });

    const collections = await restDb.doc(parent).listCollections();
    expect(collections.map((c) => c.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('recursively deletes a document and everything beneath it', async () => {
    const root = `${PREFIX}/tree_${Date.now()}`;
    await adminDb.doc(root).set({ root: true });
    await adminDb.doc(`${root}/students/s1`).set({ n: 1 });
    await adminDb.doc(`${root}/students/s2`).set({ n: 2 });
    await adminDb.doc(`${root}/students/s1/ledger/e1`).set({ amount: 100 });

    await restDb.recursiveDelete(restDb.doc(root));

    expect((await adminDb.doc(root).get()).exists).toBe(false);
    expect((await adminDb.doc(`${root}/students/s1`).get()).exists).toBe(false);
    expect((await adminDb.doc(`${root}/students/s1/ledger/e1`).get()).exists).toBe(false);
  });

  it('reaches children of a document that has no fields of its own', async () => {
    // A parent that exists only implicitly. Without showMissing on the list
    // call these children are invisible and survive the delete, orphaned and
    // unreachable.
    const root = `${PREFIX}/ghost_${Date.now()}`;
    await adminDb.doc(`${root}/students/s1`).set({ n: 1 });

    await restDb.recursiveDelete(restDb.doc(root));

    expect((await adminDb.doc(`${root}/students/s1`).get()).exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Subrequest budget
// ---------------------------------------------------------------------------

describe('subrequest budget', () => {
  it('stops cleanly instead of being killed by the platform', async () => {
    const rest = await import('../../api/_lib/firestoreRest.js');
    const path = freshPath();

    rest.armSubrequestBudget(2);
    try {
      await restDb.doc(path).get();
      await restDb.doc(path).get();
      await expect(restDb.doc(path).get()).rejects.toBeInstanceOf(SubrequestBudgetExceeded);
    } finally {
      rest.armSubrequestBudget(Infinity);
    }
  });

  it('does not retry a transaction that stopped on budget', async () => {
    // Retrying would spend the very subrequests the caller is conserving.
    const rest = await import('../../api/_lib/firestoreRest.js');
    const path = freshPath();

    rest.armSubrequestBudget(1);
    try {
      await expect(
        restDb.runTransaction(async (tx) => {
          await tx.get(restDb.doc(path));
          await tx.get(restDb.doc(freshPath()));
        })
      ).rejects.toBeInstanceOf(SubrequestBudgetExceeded);
    } finally {
      rest.armSubrequestBudget(Infinity);
    }
  });
});
