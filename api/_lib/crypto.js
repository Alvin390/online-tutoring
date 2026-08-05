import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

/**
 * AES-256-GCM envelope encryption — Phase 01 D5.
 *
 * Used from Phase 09 to hold the teacher's Daraja consumer key, consumer secret
 * and passkey at rest. Those are credentials that move real money out of a real
 * till, so they never touch Firestore in plaintext and never reach any client.
 *
 * GCM rather than CBC: it is authenticated, so a tampered ciphertext fails to
 * decrypt rather than yielding plausible garbage. A random 12-byte IV per
 * operation, which is the size GCM is specified for.
 *
 * Format: v<version>.<iv-b64>.<tag-b64>.<ciphertext-b64>
 * The version prefix exists so a key rotation can decrypt old records with the
 * old key while writing new ones with the new key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const CURRENT_VERSION = 1;

function loadKey(version = CURRENT_VERSION) {
  const envName = version === CURRENT_VERSION
    ? 'APP_ENCRYPTION_KEY'
    : `APP_ENCRYPTION_KEY_V${version}`;

  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not set`);

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${envName} must decode to exactly ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function encrypt(plaintext, version = CURRENT_VERSION) {
  const key = loadKey(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    `v${version}`,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decrypt(envelope) {
  if (typeof envelope !== 'string') throw new Error('Ciphertext must be a string');

  const parts = envelope.split('.');
  if (parts.length !== 4) throw new Error('Malformed ciphertext envelope');

  const [versionTag, ivB64, tagB64, dataB64] = parts;
  const version = Number(versionTag.replace(/^v/, ''));
  if (!Number.isInteger(version)) throw new Error('Malformed ciphertext version');

  const key = loadKey(version);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  if (iv.length !== IV_BYTES) throw new Error('Malformed ciphertext IV');
  if (tag.length !== TAG_BYTES) throw new Error('Malformed ciphertext auth tag');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Constant-time comparison of two strings of arbitrary length.
 *
 * `timingSafeEqual` throws on a length mismatch, and that throw is itself a
 * timing signal. Hashing both sides first normalises the length, so the
 * comparison leaks nothing — including nothing about the length of the secret.
 * Used for webhook signature verification.
 */
export function safeCompare(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/** Cryptographically random numeric code, for OTP. */
export function randomNumericCode(digits = 6) {
  const max = 10 ** digits;
  // Rejection sampling keeps the distribution uniform; a plain modulo would
  // bias the low end.
  const limit = Math.floor(0xffffffff / max) * max;
  let value;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return String(value % max).padStart(digits, '0');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export { CURRENT_VERSION as ENCRYPTION_KEY_VERSION };
