import { getDb, FieldValue } from './firebaseAdmin.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * The school's own M-Pesa (Daraja) keys — 013Fixes / 29 (owner answer 5,
 * round 3: "The keys are stored encrypted and never shown back").
 *
 *   config/darajaCredentials.live = {
 *     consumerKey, consumerSecret, passkey, shortCode   (each AES-256-GCM, crypto.js)
 *     shortCodeType ('till' | 'paybill'), last4 { … }, savedAt, savedBy
 *   }
 *
 * LIVE keys only: in live mode they are used before the environment's (which
 * stays the fallback, so a deployment set up by environment keeps working);
 * the sandbox always uses the environment's sandbox keys. Saving is allowed in
 * either mode, so the keys can be entered before the switch to live.
 *
 * Write-only: nothing here returns a value to a caller other than
 * loadCredentials (daraja.js), and nothing logs one. Read at most once per
 * CACHE_MS per isolate (when an M-Pesa request starts).
 */

const DOC = 'config/darajaCredentials';
const CACHE_MS = 30_000;
export const SECRET_FIELDS = ['consumerKey', 'consumerSecret', 'passkey', 'shortCode'];

let cache = null; // { at, value }

export function invalidateDarajaKeys() { cache = null; }
export const __resetDarajaKeys = invalidateDarajaKeys;

const toMs = (t) => (t?.toMillis ? t.toMillis() : t instanceof Date ? t.getTime() : null);
const last4 = (v) => String(v).slice(-4);

async function readEntry(db) {
  const snap = await db.doc(DOC).get();
  const entry = snap.exists ? snap.data()?.live : null;
  return entry && SECRET_FIELDS.every((f) => typeof entry[f] === 'string') ? entry : null;
}

/**
 * The saved live keys, decrypted, for daraja.js only — or null. A record that
 * can't be decrypted (a rotated encryption key) counts as not saved.
 */
export async function savedLiveKeys(db = getDb(), now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  let value = null;
  try {
    const entry = await readEntry(db);
    if (entry) {
      value = {
        ...Object.fromEntries(SECRET_FIELDS.map((f) => [f, decrypt(entry[f])])),
        shortCodeType: entry.shortCodeType === 'paybill' ? 'paybill' : 'till',
        savedAt: toMs(entry.savedAt),
      };
    }
  } catch {
    value = null;
  }
  cache = { at: now, value };
  return value;
}

/** What the screens may know: whether saved, the type, the last 4 characters, when. */
export async function keysView(db = getDb()) {
  const entry = await readEntry(db);
  if (!entry) return { saved: false, shortCodeType: null, last4: null, savedAt: null };
  return { saved: true, shortCodeType: entry.shortCodeType ?? null, last4: entry.last4 ?? null, savedAt: toMs(entry.savedAt) };
}

export async function saveKeys(db, values, actor, now = Date.now()) {
  await db.doc(DOC).set({
    live: {
      ...Object.fromEntries(SECRET_FIELDS.map((f) => [f, encrypt(values[f])])),
      shortCodeType: values.shortCodeType,
      last4: Object.fromEntries(SECRET_FIELDS.map((f) => [f, last4(values[f])])),
      savedAt: new Date(now),
      savedBy: actor,
    },
  }, { merge: true });
  invalidateDarajaKeys();
  return keysView(db);
}

export async function clearKeys(db) {
  const ref = db.doc(DOC);
  if ((await ref.get()).exists) await ref.update({ live: FieldValue.delete() });
  invalidateDarajaKeys();
  return keysView(db);
}
