import { randomBytes } from 'node:crypto';
import { getProjectId, loadServiceAccount, signBytes, storageAuthHeader } from './googleAuth.js';

/**
 * Cloud Storage over REST — Phase 12 D3.
 *
 * One caller: api/whatsapp/upload.js, which saves a WhatsApp attachment and
 * hands back a signed download URL. Only the three operations it uses are
 * implemented — `bucket().file().save()` and `.getSignedUrl()` — in the same
 * shapes, so that handler needs no edits.
 */

const UPLOAD_ROOT = 'https://storage.googleapis.com/upload/storage/v1/b';
const READ_ROOT = 'https://storage.googleapis.com';

/**
 * The default bucket.
 *
 * Firebase projects created before late 2024 default to `<project>.appspot.com`
 * and newer ones to `<project>.firebasestorage.app`, so guessing is not safe —
 * the configured value wins and the guess is only a last resort.
 */
export function defaultBucketName() {
  return (
    process.env.FIREBASE_STORAGE_BUCKET
    || process.env.VITE_FIREBASE_STORAGE_BUCKET
    || `${getProjectId()}.appspot.com`
  );
}

class StorageFile {
  constructor(bucketName, objectPath) {
    this.bucket = bucketName;
    this.name = objectPath;
  }

  /**
   * Uploads the bytes together with their metadata in ONE request.
   *
   * A media upload followed by a metadata PATCH would be two round trips and,
   * worse, would leave the object briefly readable without its cacheControl or
   * custom metadata. Multipart makes it atomic.
   *
   * `resumable` is accepted and ignored: the caller passes `false`, and every
   * upload here is a single small attachment well under the threshold where a
   * resumable session would earn its extra round trips.
   */
  async save(data, options = {}) {
    const boundary = `boundary${randomBytes(16).toString('hex')}`;
    const body = Buffer.from(data);

    const metadata = {
      name: this.name,
      contentType: options.contentType ?? options.metadata?.contentType ?? 'application/octet-stream',
      ...(options.metadata?.cacheControl ? { cacheControl: options.metadata.cacheControl } : {}),
      // Nested `metadata` is Cloud Storage's custom key/value bag. All values
      // must be strings or the API rejects the whole upload.
      ...(options.metadata?.metadata
        ? {
          metadata: Object.fromEntries(
            Object.entries(options.metadata.metadata).map(([k, v]) => [k, String(v)])
          ),
        }
        : {}),
    };

    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n`
        + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
        + `${JSON.stringify(metadata)}\r\n`
        + `--${boundary}\r\n`
        + `Content-Type: ${metadata.contentType}\r\n\r\n`,
        'utf8'
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);

    const url = `${UPLOAD_ROOT}/${encodeURIComponent(this.bucket)}/o?uploadType=multipart`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: await storageAuthHeader(),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Storage upload failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    return response.json();
  }

  /**
   * Signs a time-limited read URL, using the V2 scheme.
   *
   * V4 is the newer scheme and would be the default choice, but it caps expiry
   * at seven days. The caller asks for thirty — long enough that a WhatsApp
   * message opened next month still works — so V2, which has no such cap, is
   * the scheme that preserves the existing behaviour. Both sign with the same
   * service-account key; V2 is simply the older, looser canonicalisation.
   *
   * Returns an ARRAY, matching the Admin SDK's `const [url] = await ...`.
   */
  async getSignedUrl({ action = 'read', expires } = {}) {
    const method = { read: 'GET', write: 'PUT', delete: 'DELETE' }[action];
    if (!method) throw new Error(`Unsupported signed URL action: ${action}`);

    // The Admin SDK accepts millis, a Date or a parseable string.
    const expiresMs = expires instanceof Date ? expires.getTime() : Number(expires);
    if (!Number.isFinite(expiresMs)) throw new Error('getSignedUrl requires an expiry.');
    const expiresSeconds = Math.floor(expiresMs / 1000);

    const { client_email: email } = loadServiceAccount();
    const resource = `/${this.bucket}/${this.name.split('/').map(encodeURIComponent).join('/')}`;

    // V2 string-to-sign: verb, content-md5, content-type, expiry, resource.
    // The two blank lines are required — they are the empty MD5 and
    // Content-Type fields, and omitting them shifts every later field.
    const stringToSign = `${method}\n\n\n${expiresSeconds}\n${resource}`;

    const signature = await signBytes(stringToSign);

    const query = new URLSearchParams({
      GoogleAccessId: email,
      Expires: String(expiresSeconds),
      Signature: signature,
    });

    return [`${READ_ROOT}${resource}?${query.toString()}`];
  }

  async delete() {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}`
      + `/o/${encodeURIComponent(this.name)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: await storageAuthHeader() },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage delete failed (${response.status})`);
    }
  }
}

class StorageBucket {
  constructor(name) {
    this.name = name;
  }

  file(objectPath) {
    return new StorageFile(this.name, objectPath);
  }
}

/** Mirrors `getStorage(app)` from firebase-admin/storage. */
export function getStorageRest() {
  return {
    bucket: (name) => new StorageBucket(name ?? defaultBucketName()),
  };
}
