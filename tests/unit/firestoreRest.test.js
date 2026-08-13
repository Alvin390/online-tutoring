// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Firestore REST shim — Phase 12 D2, pure half.
 *
 * Everything here runs with no network and no emulator: the value codec, the
 * update-mask construction, the field transforms and the path checks. Those are
 * where a silent defect would be most expensive — a money amount decoded as a
 * float, or a merge mask that quietly deletes the field a transform was about
 * to increment — and they are fully testable in isolation.
 *
 * The behaviour that only the server can confirm (transaction retries,
 * ALREADY_EXISTS on create, server timestamps) is covered by the emulator
 * parity suite in tests/handlers/firestoreParity.test.js.
 */

let fs;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-online-tutoring';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
  fs = await import('../../api/_lib/firestoreRest.js');
});

const db = () => new fs.Firestore({ projectId: 'demo-online-tutoring' });

// ---------------------------------------------------------------------------
// Value codec
// ---------------------------------------------------------------------------

describe('value codec', () => {
  it('encodes whole numbers as integers, not doubles', () => {
    // Money in this system is a whole number of KES. A double round trip is
    // how a balance becomes 4998.999999999999.
    expect(fs.encodeValue(4999)).toEqual({ integerValue: '4999' });
    expect(fs.encodeValue(0)).toEqual({ integerValue: '0' });
    expect(fs.encodeValue(-7499)).toEqual({ integerValue: '-7499' });
  });

  it('encodes fractional numbers as doubles', () => {
    expect(fs.encodeValue(0.5)).toEqual({ doubleValue: 0.5 });
  });

  it('decodes integerValue from its string transport form', () => {
    // Firestore's JSON encoding carries integers as strings so 64-bit values
    // survive. Forgetting the Number() gives you '4999' where code expects 4999.
    expect(fs.decodeValue({ integerValue: '4999' })).toBe(4999);
    expect(typeof fs.decodeValue({ integerValue: '4999' })).toBe('number');
  });

  it('round-trips a whole KES amount exactly', () => {
    for (const amount of [0, 1, 4999, 7499, 9999, 1_000_000]) {
      expect(fs.decodeValue(fs.encodeValue(amount))).toBe(amount);
    }
  });

  it('distinguishes null from absent', () => {
    expect(fs.encodeValue(null)).toEqual({ nullValue: null });
    expect(fs.encodeValue(undefined)).toBeUndefined();

    const fields = fs.encodeFields({ present: null, missing: undefined });
    expect(fields).toHaveProperty('present');
    expect(fields).not.toHaveProperty('missing');
  });

  it('encodes Date as a timestamp and decodes it to a Timestamp object', () => {
    const date = new Date('2026-08-13T10:30:00.000Z');
    const encoded = fs.encodeValue(date);
    expect(encoded.timestampValue).toBe('2026-08-13T10:30:00.000Z');

    const decoded = fs.decodeValue(encoded);
    // Handlers call `value?.toMillis?.()` on stored dates, so a plain Date or
    // an ISO string here would silently read as undefined.
    expect(typeof decoded.toMillis).toBe('function');
    expect(decoded.toMillis()).toBe(date.getTime());
    expect(decoded.toDate().toISOString()).toBe(date.toISOString());
  });

  it('preserves sub-millisecond timestamp precision', () => {
    const decoded = fs.decodeValue({ timestampValue: '2026-08-13T10:30:00.123456789Z' });
    expect(decoded.seconds).toBe(Math.floor(Date.parse('2026-08-13T10:30:00Z') / 1000));
    expect(decoded.nanoseconds).toBe(123456789);
  });

  it('round-trips nested maps and arrays', () => {
    const value = {
      name: 'Term 1',
      recurrence: { freq: 'WEEKLY', byDay: ['MO', 'WE'], until: null },
      tags: [1, 'two', true, null],
      empty: {},
    };

    expect(fs.decodeFields(fs.encodeFields(value))).toEqual(value);
  });

  it('turns undefined inside an array into null rather than dropping it', () => {
    // Dropping it would shift every later index, which silently corrupts an
    // ordered list.
    const decoded = fs.decodeValue(fs.encodeValue([1, undefined, 3]));
    expect(decoded).toEqual([1, null, 3]);
  });

  it('round-trips booleans, strings and bytes', () => {
    expect(fs.decodeValue(fs.encodeValue(true))).toBe(true);
    expect(fs.decodeValue(fs.encodeValue(''))).toBe('');
    expect(fs.decodeValue(fs.encodeValue(Buffer.from('hi')))).toEqual(Buffer.from('hi'));
  });
});

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

describe('Timestamp', () => {
  it('converts between millis, Date and ISO without drift', () => {
    const millis = Date.parse('2026-08-13T10:30:00.250Z');
    const ts = fs.Timestamp.fromMillis(millis);

    expect(ts.toMillis()).toBe(millis);
    expect(ts.toDate().getTime()).toBe(millis);
    expect(fs.Timestamp.fromISO(ts.toISOString()).toMillis()).toBe(millis);
  });

  it('compares equal for the same instant', () => {
    const a = fs.Timestamp.fromMillis(1_700_000_000_000);
    const b = fs.Timestamp.fromMillis(1_700_000_000_000);
    expect(a.isEqual(b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write construction
// ---------------------------------------------------------------------------

describe('set with merge', () => {
  const ref = () => db().doc('fees/accounts/items/+254700000000');

  it('masks only the fields supplied', () => {
    const batch = db().batch();
    batch.set(ref(), { balance: 500, status: 'due' }, { merge: true });

    const [write] = batch._writes;
    expect(write.updateMask.fieldPaths.sort()).toEqual(['balance', 'status']);
    expect(write.update.fields.balance).toEqual({ integerValue: '500' });
  });

  it('omits the mask entirely for a full replace', () => {
    const batch = db().batch();
    batch.set(ref(), { balance: 500 });

    expect(batch._writes[0].updateMask).toBeUndefined();
  });

  it('produces leaf paths for nested maps so a merge does not clobber siblings', () => {
    // `{ a: { b: 1 } }` merged over `{ a: { c: 2 } }` must yield both keys.
    // A mask of `a` instead of `a.b` would delete `c`.
    const batch = db().batch();
    batch.set(ref(), { recurrence: { freq: 'WEEKLY', count: 4 } }, { merge: true });

    expect(batch._writes[0].updateMask.fieldPaths.sort()).toEqual([
      'recurrence.count',
      'recurrence.freq',
    ]);
  });

  it('treats an empty map as its own leaf', () => {
    const batch = db().batch();
    batch.set(ref(), { meta: {} }, { merge: true });

    expect(batch._writes[0].updateMask.fieldPaths).toEqual(['meta']);
  });
});

describe('field transforms', () => {
  const ref = () => db().doc('aggregates/dashboard');

  it('emits serverTimestamp as a REQUEST_TIME transform, not a field', () => {
    const batch = db().batch();
    batch.set(ref(), { updatedAt: fs.FieldValue.serverTimestamp() }, { merge: true });

    const [write] = batch._writes;
    expect(write.updateTransforms).toEqual([
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ]);
    expect(write.update.fields).not.toHaveProperty('updatedAt');
  });

  it('keeps transform paths OUT of the update mask', () => {
    // A masked path with no matching field is a DELETE. If `updatedAt` were
    // masked, the write would delete the field and then the transform would
    // recreate it — and worse, `increment` would be applied to a deleted value.
    const batch = db().batch();
    batch.set(
      ref(),
      { totalOutstanding: fs.FieldValue.increment(500), updatedAt: fs.FieldValue.serverTimestamp() },
      { merge: true }
    );

    expect(batch._writes[0].updateMask.fieldPaths).toEqual([]);
  });

  it('combines a transform with an ordinary field update on the same document', () => {
    // This is the exact shape postEntry() writes to the account document.
    const batch = db().batch();
    batch.set(
      ref(),
      {
        balance: 1500,
        totalOutstanding: fs.FieldValue.increment(500),
        updatedAt: fs.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const [write] = batch._writes;
    expect(write.updateMask.fieldPaths).toEqual(['balance']);
    expect(write.update.fields.balance).toEqual({ integerValue: '1500' });
    expect(write.updateTransforms).toHaveLength(2);
  });

  it('encodes increment with the value type preserved', () => {
    const batch = db().batch();
    batch.set(ref(), { n: fs.FieldValue.increment(-250) }, { merge: true });

    expect(batch._writes[0].updateTransforms[0].increment).toEqual({ integerValue: '-250' });
  });

  it('encodes arrayUnion as appendMissingElements', () => {
    const batch = db().batch();
    batch.set(ref(), { sent: fs.FieldValue.arrayUnion('r1', 'r2') }, { merge: true });

    expect(batch._writes[0].updateTransforms[0]).toEqual({
      fieldPath: 'sent',
      appendMissingElements: { values: [{ stringValue: 'r1' }, { stringValue: 'r2' }] },
    });
  });

  it('expresses FieldValue.delete() through the mask, not a transform', () => {
    const batch = db().batch();
    batch.set(ref(), { stale: fs.FieldValue.delete() }, { merge: true });

    const [write] = batch._writes;
    expect(write.updateMask.fieldPaths).toEqual(['stale']);
    expect(write.update.fields).not.toHaveProperty('stale');
    expect(write.updateTransforms).toBeUndefined();
  });
});

describe('update', () => {
  const ref = () => db().doc('calendar/events/items/e1');

  it('requires the document to exist', () => {
    const batch = db().batch();
    batch.update(ref(), { note: 'x' });

    expect(batch._writes[0].currentDocument).toEqual({ exists: true });
  });

  it('replaces a nested map wholesale rather than merging into it', () => {
    // This is where update() and set({merge:true}) genuinely differ, and
    // calendar/manage.js depends on the update() behaviour.
    const batch = db().batch();
    batch.update(ref(), { recurrence: { freq: 'WEEKLY', until: null } });

    expect(batch._writes[0].updateMask.fieldPaths).toEqual(['recurrence']);
  });

  it('honours a dotted key as an explicit field path', () => {
    const batch = db().batch();
    batch.update(ref(), { 'recurrence.until': null });

    expect(batch._writes[0].updateMask.fieldPaths).toEqual(['recurrence.until']);
  });
});

describe('create', () => {
  it('carries an exists:false precondition', () => {
    // This precondition IS the webhook idempotency guarantee.
    const batch = db().batch();
    batch.create(db().doc('billing/events'), { status: 'received' });

    expect(batch._writes[0].currentDocument).toEqual({ exists: false });
  });
});

// ---------------------------------------------------------------------------
// References and paths
// ---------------------------------------------------------------------------

describe('references', () => {
  it('rejects a document path with an odd segment count', () => {
    // Phase 09 shipped exactly this defect: db.doc('mpesa/transactions/{id}')
    // would have thrown on the first real payment callback.
    expect(() => db().doc('mpesa/transactions/abc')).toThrow(/even number of segments/);
  });

  it('rejects a collection path with an even segment count', () => {
    expect(() => db().collection('fees/accounts')).toThrow(/odd number of segments/);
  });

  it('accepts the real paths this codebase uses', () => {
    expect(() => db().doc('subscription/current')).not.toThrow();
    expect(() => db().doc('fees/accounts/items/+254700000000')).not.toThrow();
    expect(() => db().collection('fees/accounts/items')).not.toThrow();
    expect(() => db().collection('mpesa/transactions/items')).not.toThrow();
  });

  it('chains document -> collection -> document', () => {
    const ref = db().collection('billing').doc('events').collection('items').doc('evt_1');
    expect(ref.path).toBe('billing/events/items/evt_1');
    expect(ref.id).toBe('evt_1');
  });

  it('builds the fully qualified resource name', () => {
    const ref = db().doc('subscription/current');
    expect(ref._name).toBe(
      'projects/demo-online-tutoring/databases/(default)/documents/subscription/current'
    );
  });

  it('generates a 20-character auto id when none is supplied', () => {
    const ref = db().collection('fees/accounts/items/+254700000000/ledger').doc();
    expect(ref.id).toHaveLength(20);
    expect(ref.id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('generates distinct auto ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => fs.autoId()));
    expect(ids.size).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

describe('query building', () => {
  it('is immutable — refining a query does not mutate the original', () => {
    const base = db().collection('mpesa/transactions/items');
    const refined = base.where('status', '==', 'pending').limit(10);

    expect(base._parts.filters).toHaveLength(0);
    expect(refined._parts.filters).toHaveLength(1);
    expect(refined._parts.limit).toBe(10);
  });

  it('accumulates chained where clauses', () => {
    const q = db()
      .collection('calendar/events/items')
      .where('start', '>=', new Date('2026-01-01'))
      .where('start', '<=', new Date('2026-12-31'));

    expect(q._parts.filters.map((f) => f.op)).toEqual(['>=', '<=']);
  });

  it('defaults orderBy to ascending', () => {
    const q = db().collection('whatsapp/campaigns/items').orderBy('order');
    expect(q._parts.orders[0].direction).toBe('asc');
  });
});

// ---------------------------------------------------------------------------
// Subrequest budget
// ---------------------------------------------------------------------------

describe('subrequest budget', () => {
  it('is unarmed by default so Node scripts are unaffected', () => {
    fs.armSubrequestBudget(Infinity);
    expect(fs.subrequestsRemaining()).toBe(Infinity);
  });

  it('reports what is left once armed', () => {
    fs.armSubrequestBudget(45);
    expect(fs.subrequestsRemaining()).toBe(45);
    expect(fs.subrequestsSpent()).toBe(0);
  });

  it('resets on each arming, as the Worker does per invocation', () => {
    fs.armSubrequestBudget(10);
    fs.armSubrequestBudget(10);
    expect(fs.subrequestsSpent()).toBe(0);
    fs.armSubrequestBudget(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('FirestoreError', () => {
  it('exposes the gRPC numeric code call sites already check', () => {
    // billing/webhook.js and sessions/manage.js both test `err?.code === 6`.
    const err = new fs.FirestoreError(fs.GRPC_CODE.ALREADY_EXISTS, 'exists');
    expect(err.code).toBe(6);
    expect(err.slug).toBe('already-exists');
  });
});
