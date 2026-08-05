import { createHandler } from '../_lib/handler.js';
import { getAdminApp } from '../_lib/firebaseAdmin.js';
import { getStorage } from 'firebase-admin/storage';
import { z } from '../_lib/validate.js';
import { badRequest, forbidden } from '../_lib/errors.js';
import { sniffFileType, stripJpegMetadata, sanitiseFilename, MAX_UPLOAD_BYTES } from '../_lib/fileType.js';
import { randomToken } from '../_lib/crypto.js';
import { isEnabled } from '../_lib/flags.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Attachment upload — Phase 08 D1. Gold only.
 *
 * The file is uploaded THROUGH this handler rather than direct-to-Storage with
 * a signed URL, deliberately. A direct upload cannot be sniffed or stripped:
 * the bytes land in the bucket before anything has looked at them, and by then
 * the URL exists. Routing through the function costs a little latency and buys:
 *
 *   - magic-byte verification, so a renamed executable is refused
 *   - EXIF stripping, so a photo of a worksheet does not carry the teacher's
 *     home GPS coordinates to thirty parents
 *   - an unguessable filename prefix
 *
 * The 10 MB cap keeps this comfortably inside the function's body limit.
 *
 * The body is base64 rather than multipart because the payload is a single
 * file with two scalar fields; adding a multipart parser for that is more
 * dependency than it is worth, and base64's 33% overhead on a 10 MB cap is
 * still well within the request limit configured for these functions.
 */

const schema = z
  .object({
    campaignId: z.string().trim().max(64).optional(),
    filename: z.string().trim().min(1).max(200),
    contentType: z.string().trim().max(100),
    // ~13.4 MB of base64 for a 10 MB file.
    data: z.string().max(14 * 1024 * 1024),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'gold',
  schema,
  rateLimit: { bucket: 'whatsapp_upload', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    if (!(await isEnabled('whatsapp.advanced'))) {
      throw forbidden('Attachments are not switched on.', 'feature_disabled');
    }

    let buffer;
    try {
      buffer = Buffer.from(body.data, 'base64');
    } catch {
      throw badRequest('The file could not be read.');
    }

    if (buffer.length === 0) throw badRequest('The file is empty.');
    if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Files must be 10 MB or smaller.');

    // The bytes decide, not the declared type.
    const sniffed = sniffFileType(buffer, body.contentType);
    if (!sniffed.valid) throw badRequest(sniffed.error, 'unsupported_file');

    // Strip camera metadata before the bytes ever reach the bucket.
    const cleaned = sniffed.type === 'image/jpeg' ? stripJpegMetadata(buffer) : buffer;

    const token = randomToken(12);
    const safeName = sanitiseFilename(body.filename, token);
    const campaignSegment = body.campaignId ?? 'drafts';
    const storagePath = `whatsapp/${campaignSegment}/${safeName}`;

    const bucket = getStorage(getAdminApp()).bucket();
    const file = bucket.file(storagePath);

    await file.save(cleaned, {
      contentType: sniffed.type,
      resumable: false,
      metadata: {
        contentType: sniffed.type,
        cacheControl: 'private, max-age=86400',
        metadata: {
          uploadedBy: user.uid,
          originalName: safeName,
          exifStripped: String(sniffed.type === 'image/jpeg'),
        },
      },
    });

    // Signed URL, 30 days. Long enough that a link in a message a parent reads
    // next week still works; short enough that a leaked link does not live
    // forever. A Storage lifecycle rule removes the object at 90 days.
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: expiresAt });

    log.info('Attachment uploaded', {
      type: sniffed.type,
      bytes: cleaned.length,
      exifStripped: sniffed.type === 'image/jpeg',
    });

    await tryWriteAudit(
      { action: 'whatsapp.attachment_uploaded', actor: user.uid, actorRole: user.role,
        target: storagePath,
        after: { contentType: sniffed.type, sizeBytes: cleaned.length },
        context: { requestId: log.requestId } },
      log
    );

    return {
      ok: true,
      storagePath,
      downloadUrl,
      filename: safeName,
      sizeBytes: cleaned.length,
      contentType: sniffed.type,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  },
});
