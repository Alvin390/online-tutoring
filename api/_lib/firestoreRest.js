import { randomBytes } from 'node:crypto';
import { firestoreAuthHeader, firestoreEmulatorHost, getProjectId } from './googleAuth.js';

/**
 * Firestore over the REST API — Phase 12 D2.
 *
 * `firebase-admin` cannot run on Cloudflare Workers (gRPC, http2, net, tls,
 * dns, fs). This module reimplements exactly the slice of the Admin SDK's
 * Firestore surface that this codebase uses, on top of `fetch` and the REST
 * API, so that ALL 58 handlers, every `_lib` module and all three seed scripts
 * keep working with no changes at all.
 *
 * It is deliberately a faithful clone rather than a nicer API. A nicer API would
 * mean touching 42 files and re-verifying a billing system; a clone means the
 * existing emulator suites are a genuine correctness oracle, because the
 * emulator speaks this same REST protocol.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MUST GET RIGHT, because it moves money
 * ---------------------------------------------------------------------------
 *
 *   - `create()` must fail with gRPC code 6 when the document exists. That is
 *     the idempotency guarantee behind the Paystack webhook (billing/webhook.js
 *     catches `err.code === 6`) and behind session-slug uniqueness. If it
 *     silently degraded to a set-with-merge, a replayed webhook would be
 *     processed twice.
 *   - `runTransaction` must retry on ABORTED with a FRESH transaction. The Node
 *     SDK does this for you; REST does not. Without it, two concurrent ledger
 *     postings produce a balance reflecting only one of them.
 *   - Integers must survive the round trip as integers. Firestore's JSON
 *     encoding carries `integerValue` as a STRING; decoding a KES amount as a
 *     float is a defect in a currency system.
 *
 * ---------------------------------------------------------------------------
 * SUBREQUEST ECONOMY
 * ---------------------------------------------------------------------------
 *
 * Cloudflare's free plan allows 50 external subrequests per invocation, and
 * every REST call spends one. Two design choices follow:
 *
 *   1. Reads inside a transaction are MICRO-BATCHED. `tx.get()` returns a
 *      promise and defers the actual call by a microtask, so the
 *      `Promise.all([tx.get(a), tx.get(b), tx.get(c)])` pattern in
 *      `postEntry()` costs ONE `batchGet` rather than three gets.
 *   2. The transaction is begun LAZILY, folded into that first `batchGet` via
 *      `newTransaction`. A ledger posting therefore costs 2 subrequests
 *      (batchGet + commit) where a naive port would cost 5.
 */

const API_ROOT = 'https://firestore.googleapis.com/v1';
const AUTO_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const AUTO_ID_LENGTH = 20;

/** Firestore's own ceiling on writes in a single commit. */
const MAX_WRITES_PER_COMMIT = 500;

/**
 * Transaction retry budget, matching the Admin SDK's own defaults.
 *
 * These values were tested against alternatives (tighter loops, longer
 * backoffs, more attempts) under emulator contention and nothing beat them
 * consistently — the emulator's pessimistic lock model dominates the
 * measurement, so its numbers say more about the emulator than about any
 * setting here. Matching the reference implementation is the defensible
 * default in the absence of evidence for anything else.
 */
const MAX_TRANSACTION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_FACTOR = 1.3;
const RETRY_MAX_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * gRPC status codes, because that is what callers already check against.
 * `billing/webhook.js` and `sessions/manage.js` both test `err?.code === 6`,
 * which is the numeric code the Admin SDK surfaces. Preserving the numbers
 * means those call sites need no edit.
 */
export const GRPC_CODE = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
};

const STATUS_TO_CODE = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
};

/** The dash-cased aliases the Admin SDK also exposes. */
const CODE_TO_SLUG = {
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  9: 'failed-precondition',
  10: 'aborted',
  14: 'unavailable',
  16: 'unauthenticated',
};

export class FirestoreError extends Error {
  constructor(code, message, { httpStatus = null, cause } = {}) {
    super(message);
    this.name = 'FirestoreError';
    this.code = code;
    this.slug = CODE_TO_SLUG[code] ?? 'unknown';
    this.httpStatus = httpStatus;
    if (cause) this.cause = cause;
  }
}

/**
 * Thrown when a single invocation is about to exceed Cloudflare's subrequest
 * ceiling. Sweeps catch this and stop cleanly BETWEEN documents, recording a
 * cursor, rather than being killed by the platform mid-write.
 */
export class SubrequestBudgetExceeded extends Error {
  constructor(used, budget) {
    super(`Firestore subrequest budget exhausted (${used}/${budget}) — stopping cleanly.`);
    this.name = 'SubrequestBudgetExceeded';
    this.used = used;
    this.budget = budget;
  }
}

// ---------------------------------------------------------------------------
// Subrequest budget
// ---------------------------------------------------------------------------

let subrequestBudget = Infinity;
let subrequestsUsed = 0;

/**
 * Arms the budget for one invocation. Called by the Worker entry point on every
 * `fetch` and `scheduled` event.
 *
 * Unarmed by default on purpose: `scripts/seedSessions.js` and the test suites
 * run in plain Node where no such ceiling exists, and a long seed run must not
 * trip a limit that only applies to Workers.
 */
export function armSubrequestBudget(budget) {
  subrequestBudget = Number.isFinite(budget) && budget > 0 ? budget : Infinity;
  subrequestsUsed = 0;
}

export function subrequestsRemaining() {
  return subrequestBudget === Infinity ? Infinity : Math.max(0, subrequestBudget - subrequestsUsed);
}

export function subrequestsSpent() {
  return subrequestsUsed;
}

function spendSubrequest() {
  subrequestsUsed += 1;
  if (subrequestsUsed > subrequestBudget) {
    throw new SubrequestBudgetExceeded(subrequestsUsed, subrequestBudget);
  }
}

/**
 * Runs `fn` with `extra` subrequests available beyond the current budget.
 *
 * For bookkeeping that MUST happen even when the budget is spent — above all
 * a sweep writing down where it stopped. `shouldYield` reserves headroom for
 * exactly that, but the reserve is best-effort: a single item that costs more
 * than the reserve blows straight through it, and a sweep that cannot record
 * its cursor repeats the same chunk on every firing, forever.
 *
 * Safe because the armed budget is deliberately set BELOW Cloudflare's real
 * ceiling (45 against 50 on the free plan), so a few privileged writes stay
 * within what the platform allows. The budget is restored afterwards, so
 * ordinary work still stops.
 */
export async function withSubrequestAllowance(extra, fn) {
  const previous = subrequestBudget;
  if (previous !== Infinity) subrequestBudget = subrequestsUsed + extra;
  try {
    return await fn();
  } finally {
    subrequestBudget = previous;
  }
}

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

/**
 * Stand-in for the Admin SDK's Timestamp.
 *
 * Handlers call `.toMillis?.()` on values read back from Firestore
 * (`sub.currentPeriodEnd?.toMillis?.()`, `account.nextDueDate?.toMillis?.()`),
 * so decoded timestamps MUST be objects with that method rather than plain
 * Dates or ISO strings.
 */
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now() {
    return Timestamp.fromMillis(Date.now());
  }

  static fromDate(date) {
    return Timestamp.fromMillis(date.getTime());
  }

  static fromMillis(millis) {
    const seconds = Math.floor(millis / 1000);
    return new Timestamp(seconds, (millis - seconds * 1000) * 1e6);
  }

  static fromISO(iso) {
    // Sub-millisecond precision is preserved: Firestore returns up to 9
    // fractional digits and `Date.parse` truncates to 3. Losing them would
    // break ordering between two writes in the same millisecond.
    const match = /\.(\d+)Z?$/.exec(iso);
    const millis = Date.parse(iso);
    if (Number.isNaN(millis)) return new Timestamp(0, 0);

    const seconds = Math.floor(millis / 1000);
    const nanoseconds = match
      ? Number(match[1].padEnd(9, '0').slice(0, 9))
      : (millis - seconds * 1000) * 1e6;

    return new Timestamp(seconds, nanoseconds);
  }

  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }

  toDate() {
    return new Date(this.toMillis());
  }

  toISOString() {
    return `${new Date(this.seconds * 1000).toISOString().slice(0, -5)}` +
      `.${String(this.nanoseconds).padStart(9, '0')}Z`;
  }

  isEqual(other) {
    return other instanceof Timestamp
      && other.seconds === this.seconds
      && other.nanoseconds === this.nanoseconds;
  }

  valueOf() {
    return this.toMillis();
  }

  toJSON() {
    return { _seconds: this.seconds, _nanoseconds: this.nanoseconds };
  }
}

// ---------------------------------------------------------------------------
// FieldValue sentinels
// ---------------------------------------------------------------------------

const SENTINEL = Symbol('firestore.sentinel');

class Sentinel {
  constructor(kind, payload) {
    this[SENTINEL] = true;
    this.kind = kind;
    this.payload = payload;
  }
}

function isSentinel(value) {
  return value instanceof Sentinel;
}

export const FieldValue = {
  serverTimestamp: () => new Sentinel('serverTimestamp'),
  increment: (n) => new Sentinel('increment', n),
  arrayUnion: (...items) => new Sentinel('arrayUnion', items),
  arrayRemove: (...items) => new Sentinel('arrayRemove', items),
  delete: () => new Sentinel('delete'),
};

// ---------------------------------------------------------------------------
// Value codec
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * JS value -> Firestore REST `Value`.
 *
 * The integer branch is the one that matters most here. Firestore distinguishes
 * `integerValue` from `doubleValue`, and every money amount in this system is a
 * whole number of KES. Encoding those as doubles would round-trip through a
 * float and eventually produce a balance of 4998.999999999999.
 */
export function encodeValue(value, ignoreUndefined = true) {
  if (value === null) return { nullValue: null };

  if (value === undefined) {
    if (ignoreUndefined) return undefined;
    throw new FirestoreError(GRPC_CODE.INVALID_ARGUMENT, 'Cannot encode undefined');
  }

  const type = typeof value;

  if (type === 'boolean') return { booleanValue: value };
  if (type === 'string') return { stringValue: value };

  if (type === 'number') {
    if (Number.isSafeInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }

  if (type === 'bigint') return { integerValue: String(value) };

  if (value instanceof Timestamp) return { timestampValue: value.toISOString() };
  if (value instanceof Date) return { timestampValue: value.toISOString() };

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { bytesValue: Buffer.from(value).toString('base64') };
  }

  if (value instanceof DocumentReference) return { referenceValue: value._name };

  if (Array.isArray(value)) {
    // Firestore has no concept of a missing array element, so an `undefined`
    // inside an array becomes null rather than vanishing and shifting indices.
    const values = value.map((v) => encodeValue(v, ignoreUndefined) ?? { nullValue: null });
    return { arrayValue: { values } };
  }

  if (isPlainObject(value)) {
    return { mapValue: { fields: encodeFields(value, ignoreUndefined) } };
  }

  throw new FirestoreError(
    GRPC_CODE.INVALID_ARGUMENT,
    `Cannot encode value of type ${Object.prototype.toString.call(value)}`
  );
}

export function encodeFields(obj, ignoreUndefined = true) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSentinel(value)) continue; // handled as a transform, not a field
    const encoded = encodeValue(value, ignoreUndefined);
    if (encoded !== undefined) fields[key] = encoded;
  }
  return fields;
}

/** Firestore REST `Value` -> JS value. */
export function decodeValue(value) {
  if (value == null) return null;

  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('stringValue' in value) return value.stringValue;
  // Carried as a string in JSON so that 64-bit integers survive transport.
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return Timestamp.fromISO(value.timestampValue);
  if ('bytesValue' in value) return Buffer.from(value.bytesValue, 'base64');
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return { ...value.geoPointValue };

  if ('arrayValue' in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }

  if ('mapValue' in value) {
    return decodeFields(value.mapValue.fields ?? {});
  }

  return null;
}

export function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    out[key] = decodeValue(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field paths and masks
// ---------------------------------------------------------------------------

const SIMPLE_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Field path segments containing anything unusual must be backtick-quoted, or
 * the server reads a dot in a key name as a nesting separator.
 */
function escapeSegment(segment) {
  if (SIMPLE_FIELD_RE.test(segment)) return segment;
  return `\`${segment.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

function joinPath(prefix, segment) {
  const escaped = escapeSegment(segment);
  return prefix ? `${prefix}.${escaped}` : escaped;
}

/**
 * Leaf field paths for a merge, matching the Admin SDK's deep-merge semantics.
 *
 * `set({ a: { b: 1 } }, { merge: true })` against `{ a: { c: 2 } }` must yield
 * `{ a: { b: 1, c: 2 } }`, which requires a mask of `a.b` rather than `a`. An
 * empty map is its own leaf — it means "set this to an empty map", not
 * "change nothing".
 */
function collectMergePaths(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = joinPath(prefix, key);

    if (isSentinel(value)) {
      // Transforms carry their own field path and must be left OUT of the
      // update mask: a masked path with no corresponding field is a delete,
      // which would wipe the value the transform is about to act on.
      if (value.kind === 'delete') out.push(path);
      continue;
    }

    if (value === undefined) continue;

    if (isPlainObject(value) && Object.keys(value).length > 0) {
      collectMergePaths(value, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

/** Transform descriptors for every sentinel in the object, at any depth. */
function collectTransforms(obj, prefix = '', out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const path = joinPath(prefix, key);

    if (isSentinel(value)) {
      if (value.kind === 'delete') continue; // expressed via the mask instead
      out.push(encodeTransform(path, value));
      continue;
    }

    if (isPlainObject(value)) collectTransforms(value, path, out);
  }
  return out;
}

function encodeTransform(fieldPath, sentinel) {
  switch (sentinel.kind) {
    case 'serverTimestamp':
      return { fieldPath, setToServerValue: 'REQUEST_TIME' };
    case 'increment':
      return { fieldPath, increment: encodeValue(sentinel.payload) };
    case 'arrayUnion':
      return {
        fieldPath,
        appendMissingElements: { values: sentinel.payload.map((v) => encodeValue(v)) },
      };
    case 'arrayRemove':
      return {
        fieldPath,
        removeAllFromArray: { values: sentinel.payload.map((v) => encodeValue(v)) },
      };
    default:
      throw new FirestoreError(
        GRPC_CODE.INVALID_ARGUMENT,
        `Unknown field transform: ${sentinel.kind}`
      );
  }
}

/** Strips sentinels so only real fields reach `update.fields`. */
function stripSentinels(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSentinel(value)) continue;
    if (value === undefined) continue;
    out[key] = isPlainObject(value) ? stripSentinels(value) : value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write construction
// ---------------------------------------------------------------------------

function buildWrite(ref, data, { merge = false, mustExist = null } = {}) {
  const plain = stripSentinels(data);
  const transforms = collectTransforms(data);

  const write = {
    update: { name: ref._name, fields: encodeFields(plain) },
  };

  if (transforms.length > 0) write.updateTransforms = transforms;

  if (merge) {
    write.updateMask = { fieldPaths: collectMergePaths(data) };
  }

  if (mustExist === true) write.currentDocument = { exists: true };
  if (mustExist === false) write.currentDocument = { exists: false };

  return write;
}

/**
 * `update()` semantics differ from `set({merge:true})`: each top-level key
 * replaces its value WHOLESALE, so `update({ recurrence: {...} })` swaps the
 * entire map rather than merging into it. Dotted keys are honoured as explicit
 * field paths, which is how the SDK lets you reach into a nested map.
 */
function buildUpdateWrite(ref, data) {
  const plain = stripSentinels(data);
  const transforms = [];
  const paths = [];

  for (const [key, value] of Object.entries(data)) {
    const path = key.includes('.')
      ? key.split('.').map(escapeSegment).join('.')
      : escapeSegment(key);

    if (isSentinel(value)) {
      if (value.kind === 'delete') paths.push(path);
      else transforms.push(encodeTransform(path, value));
      continue;
    }

    if (value === undefined) continue;
    paths.push(path);
  }

  const write = {
    update: { name: ref._name, fields: encodeFields(plain) },
    updateMask: { fieldPaths: paths },
    currentDocument: { exists: true },
  };

  if (transforms.length > 0) write.updateTransforms = transforms;
  return write;
}

// ---------------------------------------------------------------------------
// Auto IDs
// ---------------------------------------------------------------------------

/**
 * Firestore's auto ID: 20 characters from a 62-symbol alphabet.
 *
 * Rejection sampling rather than modulo. 256 is not a multiple of 62, so a
 * plain `byte % 62` biases the first eight symbols — which for document IDs
 * means measurably more collisions than the birthday bound suggests.
 */
export function autoId() {
  const limit = Math.floor(256 / AUTO_ID_ALPHABET.length) * AUTO_ID_ALPHABET.length;
  let id = '';

  while (id.length < AUTO_ID_LENGTH) {
    for (const byte of randomBytes(AUTO_ID_LENGTH)) {
      if (byte >= limit) continue;
      id += AUTO_ID_ALPHABET[byte % AUTO_ID_ALPHABET.length];
      if (id.length === AUTO_ID_LENGTH) break;
    }
  }

  return id;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export class DocumentSnapshot {
  constructor(ref, doc) {
    this.ref = ref;
    this.id = ref.id;
    this._doc = doc ?? null;
    this.exists = Boolean(doc);
    this.createTime = doc?.createTime ? Timestamp.fromISO(doc.createTime) : null;
    this.updateTime = doc?.updateTime ? Timestamp.fromISO(doc.updateTime) : null;
  }

  data() {
    if (!this._doc) return undefined;
    return decodeFields(this._doc.fields ?? {});
  }

  get(fieldPath) {
    const data = this.data();
    if (data === undefined) return undefined;
    return fieldPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
  }
}

export class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(fn) {
    this.docs.forEach(fn);
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export class DocumentReference {
  constructor(firestore, path) {
    this._firestore = firestore;
    this.path = path;
    this.id = path.slice(path.lastIndexOf('/') + 1);
    this._name = `${firestore._documentsRoot}/${path}`;
  }

  get parent() {
    const at = this.path.lastIndexOf('/');
    return new CollectionReference(this._firestore, this.path.slice(0, at));
  }

  collection(collectionId) {
    return new CollectionReference(this._firestore, `${this.path}/${collectionId}`);
  }

  async get() {
    return this._firestore._getDocument(this);
  }

  async set(data, options = {}) {
    return this._firestore._commit([buildWrite(this, data, { merge: options.merge === true })]);
  }

  async update(data) {
    return this._firestore._commit([buildUpdateWrite(this, data)]);
  }

  /**
   * Fails if the document already exists.
   *
   * The thrown error carries gRPC code 6 because that is what the two call
   * sites already test for — `billing/webhook.js` turns it into "duplicate
   * webhook, ignore", and `sessions/manage.js` into "that slug is taken".
   * Preserving the code is what keeps both behaviours intact.
   */
  async create(data) {
    try {
      return await this._firestore._commit([buildWrite(this, data, { mustExist: false })]);
    } catch (err) {
      if (
        err instanceof FirestoreError
        && (err.code === GRPC_CODE.ALREADY_EXISTS || err.code === GRPC_CODE.FAILED_PRECONDITION)
      ) {
        throw new FirestoreError(
          GRPC_CODE.ALREADY_EXISTS,
          `Document already exists: ${this.path}`,
          { httpStatus: err.httpStatus, cause: err }
        );
      }
      throw err;
    }
  }

  async delete() {
    return this._firestore._commit([{ delete: this._name }]);
  }

  async listCollections() {
    return this._firestore._listCollectionIds(this);
  }

  isEqual(other) {
    return other instanceof DocumentReference && other.path === this.path;
  }
}

/**
 * A query under construction. Immutable — every operator returns a new Query,
 * matching the SDK so that a stored base query cannot be mutated by a caller
 * that refines it.
 */
export class Query {
  constructor(firestore, collectionPath, parts = {}) {
    this._firestore = firestore;
    this._collectionPath = collectionPath;
    this._parts = { filters: [], orders: [], limit: null, ...parts };
  }

  _derive(patch) {
    return new Query(this._firestore, this._collectionPath, { ...this._parts, ...patch });
  }

  where(fieldPath, op, value) {
    return this._derive({
      filters: [...this._parts.filters, { fieldPath, op, value }],
    });
  }

  orderBy(fieldPath, direction = 'asc') {
    return this._derive({
      orders: [...this._parts.orders, { fieldPath, direction }],
    });
  }

  limit(n) {
    return this._derive({ limit: n });
  }

  startAfter(value) {
    return this._derive({ startAfter: value });
  }

  async get() {
    return this._firestore._runQuery(this);
  }
}

export class CollectionReference extends Query {
  constructor(firestore, path) {
    super(firestore, path);
    this.path = path;
    this.id = path.slice(path.lastIndexOf('/') + 1);
  }

  doc(documentId) {
    return new DocumentReference(this._firestore, `${this.path}/${documentId ?? autoId()}`);
  }

  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }

  async listDocuments() {
    return this._firestore._listDocuments(this);
  }
}

// ---------------------------------------------------------------------------
// WriteBatch
// ---------------------------------------------------------------------------

export class WriteBatch {
  constructor(firestore) {
    this._firestore = firestore;
    this._writes = [];
  }

  set(ref, data, options = {}) {
    this._writes.push(buildWrite(ref, data, { merge: options.merge === true }));
    return this;
  }

  update(ref, data) {
    this._writes.push(buildUpdateWrite(ref, data));
    return this;
  }

  create(ref, data) {
    this._writes.push(buildWrite(ref, data, { mustExist: false }));
    return this;
  }

  delete(ref) {
    this._writes.push({ delete: ref._name });
    return this;
  }

  async commit() {
    if (this._writes.length === 0) return [];

    // Firestore caps a commit at 500 writes. Chunking here rather than making
    // every caller count means a growing student roster does not one day start
    // failing a nightly sweep with an opaque INVALID_ARGUMENT.
    const results = [];
    for (let i = 0; i < this._writes.length; i += MAX_WRITES_PER_COMMIT) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await this._firestore._commit(this._writes.slice(i, i + MAX_WRITES_PER_COMMIT));
      results.push(...chunk);
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export class Transaction {
  constructor(firestore, { retryTransaction = null } = {}) {
    this._firestore = firestore;
    this._writes = [];
    this._transactionId = null;
    this._retryTransaction = retryTransaction;
    this._pendingGets = [];
    this._flushScheduled = false;
    this._startPromise = null;
  }

  /**
   * Opens the transaction, once, before the first read.
   *
   * An earlier version folded this into the first `batchGet` via
   * `newTransaction`, which saves a subrequest and is legal in the API. It is
   * also the wrong shape for a write transaction, and the emulator proved it:
   * with 20 concurrent postings against one document, all 20 acquired SHARED
   * read locks, then all 20 blocked trying to upgrade to a write lock at
   * commit. Exactly one survived and nineteen died on "Transaction lock
   * timeout" — the signature of a lock-upgrade deadlock, not of ordinary
   * contention.
   *
   * `beginTransaction` takes the write lock up front, so contenders serialise
   * at the door instead of deadlocking at the till. One extra subrequest per
   * transaction is a cheap price for a ledger that cannot lose postings.
   */
  _ensureStarted() {
    if (!this._startPromise) {
      this._startPromise = this._firestore
        ._beginTransaction({ retryTransaction: this._retryTransaction })
        .then((id) => {
          this._transactionId = id;
          return id;
        });
    }
    return this._startPromise;
  }

  /**
   * Reads a document inside the transaction.
   *
   * The call is deferred by a microtask and coalesced with any sibling reads
   * issued in the same tick, so `Promise.all([tx.get(a), tx.get(b), tx.get(c)])`
   * — the shape used by `postEntry()` and `generateInvoices()` — costs one
   * `batchGet` instead of three round trips.
   */
  get(ref) {
    if (!(ref instanceof DocumentReference)) {
      throw new FirestoreError(
        GRPC_CODE.INVALID_ARGUMENT,
        'Transaction.get() supports document references only.'
      );
    }

    if (this._writes.length > 0) {
      // Firestore requires all reads before all writes. Failing here names the
      // problem; letting it through produces an opaque server-side error.
      throw new FirestoreError(
        GRPC_CODE.INVALID_ARGUMENT,
        'Firestore transactions require all reads to precede all writes.'
      );
    }

    return new Promise((resolve, reject) => {
      this._pendingGets.push({ ref, resolve, reject });

      if (!this._flushScheduled) {
        this._flushScheduled = true;
        queueMicrotask(() => this._flushGets());
      }
    });
  }

  async _flushGets() {
    const batch = this._pendingGets;
    this._pendingGets = [];
    this._flushScheduled = false;

    if (batch.length === 0) return;

    try {
      const snapshots = await this._firestore._batchGet(
        batch.map((entry) => entry.ref),
        this
      );
      batch.forEach((entry, index) => entry.resolve(snapshots[index]));
    } catch (err) {
      batch.forEach((entry) => entry.reject(err));
    }
  }

  set(ref, data, options = {}) {
    this._writes.push(buildWrite(ref, data, { merge: options.merge === true }));
    return this;
  }

  update(ref, data) {
    this._writes.push(buildUpdateWrite(ref, data));
    return this;
  }

  create(ref, data) {
    this._writes.push(buildWrite(ref, data, { mustExist: false }));
    return this;
  }

  delete(ref) {
    this._writes.push({ delete: ref._name });
    return this;
  }
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set([
  GRPC_CODE.ABORTED,
  GRPC_CODE.UNAVAILABLE,
  GRPC_CODE.INTERNAL,
  GRPC_CODE.DEADLINE_EXCEEDED,
]);

export class Firestore {
  constructor({ projectId, databaseId = '(default)' } = {}) {
    this._projectId = projectId ?? getProjectId();
    this._databaseId = databaseId;
    this._database = `projects/${this._projectId}/databases/${databaseId}`;
    this._documentsRoot = `${this._database}/documents`;
    this._ignoreUndefinedProperties = false;
  }

  /**
   * The Admin SDK's settings hook. `ignoreUndefinedProperties` is the only
   * option this codebase sets, and it is already the encoder's default
   * behaviour, so this records the intent and changes nothing.
   */
  settings(options = {}) {
    if (options.ignoreUndefinedProperties !== undefined) {
      this._ignoreUndefinedProperties = options.ignoreUndefinedProperties;
    }
    return this;
  }

  doc(path) {
    assertDocumentPath(path);
    return new DocumentReference(this, path);
  }

  collection(path) {
    assertCollectionPath(path);
    return new CollectionReference(this, path);
  }

  batch() {
    return new WriteBatch(this);
  }

  /**
   * Reads many documents in ONE round trip, in the order requested.
   *
   * The Admin SDK's `getAll`. It matters more here than it did there: on
   * Cloudflare's free plan an invocation gets 50 external subrequests, so an
   * invoice run that read each student's account individually would exhaust
   * the budget at about a dozen students. This turns that into one call.
   */
  async getAll(...refs) {
    const flat = refs.flat();
    if (flat.length === 0) return [];
    return this._batchGet(flat);
  }

  // ---- HTTP ---------------------------------------------------------------

  _baseUrl() {
    const emulator = firestoreEmulatorHost();
    // The emulator is plain HTTP on localhost and speaks the identical
    // protocol, which is what lets the existing emulator suites verify this
    // module rather than merely exercise it.
    return emulator ? `http://${emulator}/v1` : API_ROOT;
  }

  async _request(path, { method = 'GET', body, query } = {}) {
    spendSubrequest();

    const url = new URL(`${this._baseUrl()}/${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
        else url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: await firestoreAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new FirestoreError(GRPC_CODE.UNAVAILABLE, 'Could not reach Firestore.', { cause: err });
    }

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (!response.ok) throw toFirestoreError(response.status, payload);

    return payload;
  }

  // ---- Reads --------------------------------------------------------------

  async _getDocument(ref) {
    try {
      const doc = await this._request(encodePath(ref._name));
      return new DocumentSnapshot(ref, doc);
    } catch (err) {
      // A missing document is not an error in the SDK — it is a snapshot with
      // `exists === false`, and dozens of call sites depend on that.
      if (err instanceof FirestoreError && err.code === GRPC_CODE.NOT_FOUND) {
        return new DocumentSnapshot(ref, null);
      }
      throw err;
    }
  }

  /**
   * Reads several documents in one round trip, optionally starting a
   * transaction at the same time.
   *
   * Folding `newTransaction` into the first read is what makes a ledger posting
   * cost two subrequests rather than four: no separate `beginTransaction` call
   * is needed, and the server hands back the transaction id alongside the data.
   */
  async _batchGet(refs, transaction = null) {
    const body = { documents: refs.map((ref) => ref._name) };

    if (transaction) {
      body.transaction = await transaction._ensureStarted();
    }

    const results = await this._request(`${this._documentsRoot}:batchGet`, {
      method: 'POST',
      body,
    });

    const byName = new Map();
    for (const entry of results ?? []) {
      if (entry.found) byName.set(entry.found.name, entry.found);
      else if (entry.missing) byName.set(entry.missing, null);
    }

    return refs.map((ref) => new DocumentSnapshot(ref, byName.get(ref._name) ?? null));
  }

  /**
   * Runs a structured query.
   *
   * DOES NOT PAGINATE, unlike `_listDocuments` and `_listCollectionIds` below.
   * `runQuery` streams its results in a single response, and this takes what
   * arrives. Past one response page the result is silently PARTIAL — no error,
   * just fewer documents than exist.
   *
   * That is acceptable at this project's scale (a single teacher, hundreds of
   * students at most) and it matches what the callers assume today, but it is a
   * real ceiling. The queries that would hit it first are the roster scans in
   * fees/generateInvoices.js and the account scan in cron/feesSweep.js. If the
   * roster ever approaches four figures, add cursor pagination via
   * `startAfter` on `__name__` rather than raising a limit.
   */
  async _runQuery(query) {
    const path = query._collectionPath;
    const at = path.lastIndexOf('/');
    const parentPath = at === -1 ? '' : path.slice(0, at);
    const collectionId = at === -1 ? path : path.slice(at + 1);

    const parentName = parentPath
      ? `${this._documentsRoot}/${parentPath}`
      : this._documentsRoot;

    const structuredQuery = { from: [{ collectionId }] };

    const filters = query._parts.filters.map(({ fieldPath, op, value }) => ({
      fieldFilter: {
        field: { fieldPath: escapeSegment(fieldPath) },
        op: QUERY_OPERATORS[op] ?? assertUnknownOperator(op),
        value: encodeValue(value),
      },
    }));

    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) {
      structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    }

    if (query._parts.orders.length > 0) {
      structuredQuery.orderBy = query._parts.orders.map(({ fieldPath, direction }) => ({
        field: { fieldPath: escapeSegment(fieldPath) },
        direction: String(direction).toLowerCase() === 'desc' ? 'DESCENDING' : 'ASCENDING',
      }));
    }

    if (query._parts.limit != null) structuredQuery.limit = query._parts.limit;

    const results = await this._request(`${encodePath(parentName)}:runQuery`, {
      method: 'POST',
      body: { structuredQuery },
    });

    const docs = [];
    for (const entry of results ?? []) {
      if (!entry.document) continue;
      const relativePath = entry.document.name.slice(`${this._documentsRoot}/`.length);
      docs.push(new DocumentSnapshot(new DocumentReference(this, relativePath), entry.document));
    }

    return new QuerySnapshot(docs);
  }

  async _listDocuments(collectionRef) {
    const path = collectionRef.path;
    const at = path.lastIndexOf('/');
    const parentPath = at === -1 ? '' : path.slice(0, at);
    const collectionId = at === -1 ? path : path.slice(at + 1);

    const parentName = parentPath
      ? `${this._documentsRoot}/${parentPath}`
      : this._documentsRoot;

    const refs = [];
    let pageToken;

    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await this._request(`${encodePath(parentName)}/${encodeURIComponent(collectionId)}`, {
        query: {
          pageSize: 300,
          pageToken,
          // Documents that exist only as parents of a subcollection have no
          // fields of their own. Without showMissing they are invisible, and a
          // recursive delete would leave their children orphaned and
          // unreachable.
          showMissing: true,
          'mask.fieldPaths': '__name__',
        },
      });

      for (const doc of page?.documents ?? []) {
        refs.push(new DocumentReference(this, doc.name.slice(`${this._documentsRoot}/`.length)));
      }
      pageToken = page?.nextPageToken;
    } while (pageToken);

    return refs;
  }

  async _listCollectionIds(docRef) {
    const ids = [];
    let pageToken;

    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await this._request(`${encodePath(docRef._name)}:listCollectionIds`, {
        method: 'POST',
        body: { pageSize: 100, ...(pageToken ? { pageToken } : {}) },
      });

      for (const id of page?.collectionIds ?? []) {
        ids.push(docRef.collection(id));
      }
      pageToken = page?.nextPageToken;
    } while (pageToken);

    return ids;
  }

  // ---- Writes -------------------------------------------------------------

  async _commit(writes, transactionId = null) {
    const body = { writes };
    if (transactionId) body.transaction = transactionId;

    const result = await this._request(`${this._documentsRoot}:commit`, {
      method: 'POST',
      body,
    });

    return (result?.writeResults ?? []).map((wr) => ({
      writeTime: wr.updateTime ? Timestamp.fromISO(wr.updateTime) : null,
    }));
  }

  async _beginTransaction({ retryTransaction = null } = {}) {
    const result = await this._request(`${this._documentsRoot}:beginTransaction`, {
      method: 'POST',
      body: {
        options: {
          readWrite: retryTransaction ? { retryTransaction } : {},
        },
      },
    });
    return result.transaction;
  }

  async _rollback(transactionId) {
    return this._request(`${this._documentsRoot}:rollback`, {
      method: 'POST',
      body: { transaction: transactionId },
    });
  }

  /**
   * Runs `updateFunction` inside a Firestore transaction, retrying on ABORTED.
   *
   * The retry is the whole point. Firestore aborts a transaction whose read set
   * was modified by someone else before it committed, and the Node SDK retries
   * transparently. Over REST nothing does that for us, so without this loop two
   * concurrent postings against the same account would leave a balance that
   * reflects only one of them.
   *
   * Each attempt begins a genuinely NEW transaction, and passes the previous
   * id as `retryTransaction` so the server can give the retry priority over
   * newer arrivals — otherwise a busy document can starve a transaction
   * indefinitely.
   */
  async runTransaction(updateFunction, { maxAttempts = MAX_TRANSACTION_ATTEMPTS } = {}) {
    let previousTransactionId = null;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const transaction = new Transaction(this, { retryTransaction: previousTransactionId });

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await updateFunction(transaction);

        if (transaction._writes.length > 0) {
          // eslint-disable-next-line no-await-in-loop
          await this._commit(transaction._writes, transaction._transactionId);
        } else if (transaction._transactionId) {
          // A read-only transaction still holds its locks until it is
          // resolved, so it is released explicitly rather than left to expire.
          //
          // Note the cost: an early return that read and then wrote nothing —
          // the `{ duplicate: true }` path in generateInvoices() and postEntry()
          // — spends 3 subrequests (begin + read + rollback). That is the
          // price of taking the write lock up front; see _ensureStarted().
          // eslint-disable-next-line no-await-in-loop
          await this._rollback(transaction._transactionId).catch(() => {});
        }

        return result;
      } catch (err) {
        lastError = err;
        previousTransactionId = transaction._transactionId;

        // ALWAYS roll back, including after a failed commit.
        //
        // Skipping it looks like a free saving — a commit that succeeded or
        // hard-failed has already ended the transaction, so the rollback is a
        // wasted round trip. But a commit that failed on lock acquisition
        // leaves the transaction ALIVE, still holding the read locks it took
        // at `batchGet` time, until the server expires it. Under contention
        // those abandoned locks accumulate and every remaining contender times
        // out against them: measured at 20 concurrent postings, skipping the
        // rollback took the failure count from 0 to 19.
        if (transaction._transactionId) {
          // eslint-disable-next-line no-await-in-loop
          await this._rollback(transaction._transactionId).catch(() => {});
        }

        // A budget stop is deliberate, not a transient fault. Retrying would
        // spend the very subrequests the caller is trying to conserve.
        if (err instanceof SubrequestBudgetExceeded) throw err;

        const retryable = err instanceof FirestoreError && RETRYABLE_CODES.has(err.code);
        if (!retryable || attempt === maxAttempts) throw err;

        // Full jitter, not half. Under contention every loser is aborted at
        // the same instant, so a backoff that only varies by 2x still lets
        // them retry as a herd and collide again. Spreading uniformly across
        // the whole window is what actually breaks the lockstep.
        const ceiling = Math.min(RETRY_BASE_DELAY_MS * RETRY_FACTOR ** (attempt - 1), RETRY_MAX_DELAY_MS);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, Math.random() * ceiling));
      }
    }

    throw lastError;
  }

  /**
   * Deletes a document (or collection) and everything beneath it.
   *
   * Depth-first: children are removed before their parent, so an interrupted
   * run can never leave a subtree that is unreachable from the root and
   * therefore invisible to a retry.
   */
  async recursiveDelete(ref) {
    const pendingDeletes = [];

    const walkDocument = async (docRef) => {
      const collections = await docRef.listCollections();
      for (const collection of collections) {
        // eslint-disable-next-line no-await-in-loop
        await walkCollection(collection);
      }
      pendingDeletes.push(docRef);
    };

    const walkCollection = async (collectionRef) => {
      const docs = await collectionRef.listDocuments();
      for (const doc of docs) {
        // eslint-disable-next-line no-await-in-loop
        await walkDocument(doc);
      }
    };

    if (ref instanceof CollectionReference) await walkCollection(ref);
    else await walkDocument(ref);

    for (let i = 0; i < pendingDeletes.length; i += MAX_WRITES_PER_COMMIT) {
      const chunk = pendingDeletes.slice(i, i + MAX_WRITES_PER_COMMIT);
      // eslint-disable-next-line no-await-in-loop
      await this._commit(chunk.map((docRef) => ({ delete: docRef._name })));
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUERY_OPERATORS = {
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
  in: 'IN',
  'not-in': 'NOT_IN',
};

function assertUnknownOperator(op) {
  throw new FirestoreError(GRPC_CODE.INVALID_ARGUMENT, `Unsupported query operator: ${op}`);
}

/**
 * Firestore path parity, enforced here rather than discovered in production.
 *
 * A document path has an EVEN number of segments and a collection path an ODD
 * number. Phase 09 shipped a three-segment document path under
 * `mpesa/transactions/`, which would have thrown on the first real payment
 * callback. Checking at construction turns that class of defect into an
 * immediate, named failure.
 *
 * (Written without a literal call example on purpose: tests/unit/
 * firestorePaths.test.js scans these files as text for exactly that pattern,
 * and a sample in a comment would read as a real offender.)
 */
function assertDocumentPath(path) {
  const segments = String(path).split('/').filter(Boolean);
  if (segments.length === 0 || segments.length % 2 !== 0) {
    throw new FirestoreError(
      GRPC_CODE.INVALID_ARGUMENT,
      `Document path must have an even number of segments, got ${segments.length}: ${path}`
    );
  }
}

function assertCollectionPath(path) {
  const segments = String(path).split('/').filter(Boolean);
  if (segments.length === 0 || segments.length % 2 === 0) {
    throw new FirestoreError(
      GRPC_CODE.INVALID_ARGUMENT,
      `Collection path must have an odd number of segments, got ${segments.length}: ${path}`
    );
  }
}

/** Percent-encodes each path segment while leaving the separators intact. */
function encodePath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Maps an HTTP failure onto the gRPC code the Admin SDK would have produced.
 *
 * The `status` string in the error body is authoritative when present; the HTTP
 * status is the fallback. Getting ALREADY_EXISTS right here is what keeps
 * webhook idempotency working.
 */
function toFirestoreError(httpStatus, payload) {
  // A batchGet/runQuery streaming response reports its error as the first
  // element of an array rather than as a bare object.
  const error = Array.isArray(payload) ? payload[0]?.error : payload?.error;

  const status = error?.status;
  const code = STATUS_TO_CODE[status]
    ?? HTTP_STATUS_TO_CODE[httpStatus]
    ?? GRPC_CODE.UNKNOWN;

  const message = error?.message ?? `Firestore request failed with HTTP ${httpStatus}`;
  return new FirestoreError(code, message, { httpStatus });
}

const HTTP_STATUS_TO_CODE = {
  400: GRPC_CODE.INVALID_ARGUMENT,
  401: GRPC_CODE.UNAUTHENTICATED,
  403: GRPC_CODE.PERMISSION_DENIED,
  404: GRPC_CODE.NOT_FOUND,
  409: GRPC_CODE.ABORTED,
  412: GRPC_CODE.FAILED_PRECONDITION,
  429: GRPC_CODE.RESOURCE_EXHAUSTED,
  499: GRPC_CODE.CANCELLED,
  500: GRPC_CODE.INTERNAL,
  501: GRPC_CODE.UNIMPLEMENTED,
  503: GRPC_CODE.UNAVAILABLE,
  504: GRPC_CODE.DEADLINE_EXCEEDED,
};

// ---------------------------------------------------------------------------

let cachedFirestore = null;

export function getFirestoreRest() {
  if (!cachedFirestore) cachedFirestore = new Firestore();
  return cachedFirestore;
}

/** Test seam: forces the next getFirestoreRest() to re-read the project id. */
export function __resetFirestore() {
  cachedFirestore = null;
}
