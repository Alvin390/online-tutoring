import { createHash } from 'node:crypto';
import { createHandler } from '../_lib/handler.js';
import { getDb, getStorage } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { ApiError, badRequest, forbidden } from '../_lib/errors.js';
import { sniffFileType, stripJpegMetadata } from '../_lib/fileType.js';
import { MAX_ATTACHMENTS, MAX_FULL_BYTES, MAX_THUMB_BYTES } from '../_lib/reports.js';

/**
 * Upload ONE screenshot for a report that is being written — Phase 13 / 06 D2.
 *
 * The browser has already resized (≤ 1600 px) and re-encoded it as WebP, and
 * made a ≤ 320 px thumbnail. Each goes up in its own request, under the 256 KB
 * body cap, as base64 JSON — the same shape as the WhatsApp attachment upload.
 *
 * Through the server rather than direct-to-Storage, deliberately: the bytes are
 * sniffed (a renamed PDF or SVG is refused), JPEG camera metadata is stripped,
 * and `storage.rules` stays deny-all.
 *
 * The report id is a UUID made by the browser before submit, so screenshots
 * can upload while the teacher is still typing. `reportUploads/{id}` records
 * who owns that id (another teacher cannot write into it) and which files
 * exist; the submit endpoint reads it rather than trusting paths from the
 * client, then deletes it. Uploads never submitted are purged after 24 h
 * (notificationsSweep).
 */

const IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg'];
const EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

const schema = z
  .object({
    reportId: z.string().uuid(),
    index: z.number().int().min(0).max(MAX_ATTACHMENTS - 1),
    variant: z.enum(['full', 'thumb']),
    contentType: z.string().trim().max(40),
    // base64 of at most MAX_FULL_BYTES
    data: z.string().min(8).max(Math.ceil((MAX_FULL_BYTES * 4) / 3) + 8),
    width: z.number().int().min(1).max(10000).optional(),
    height: z.number().int().min(1).max(10000).optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  schema,
  rateLimit: { bucket: 'report_attachment', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();

    if ((await db.doc(`reports/${body.reportId}`).get()).exists) {
      throw new ApiError(409, 'already_submitted', 'That report has already been sent.');
    }

    const uploadsRef = db.doc(`reportUploads/${body.reportId}`);
    const uploads = await uploadsRef.get();
    if (uploads.exists && uploads.data().uid !== user.uid) {
      throw forbidden('That report belongs to someone else.');
    }

    const buffer = Buffer.from(body.data, 'base64');
    const limit = body.variant === 'thumb' ? MAX_THUMB_BYTES : MAX_FULL_BYTES;
    if (buffer.length === 0) throw badRequest('The image is empty.');
    if (buffer.length > limit) {
      throw new ApiError(413, 'payload_too_large', `Images must be ${Math.round(limit / 1000)} KB or smaller after compression.`);
    }

    // The bytes decide, not the declared type.
    const sniffed = sniffFileType(buffer, body.contentType);
    if (!sniffed.valid || !IMAGE_TYPES.includes(sniffed.type)) {
      throw badRequest('Only PNG, JPEG or WebP screenshots can be attached.', 'unsupported_file');
    }
    const cleaned = sniffed.type === 'image/jpeg' ? stripJpegMetadata(buffer) : buffer;
    const sha256 = createHash('sha256').update(cleaned).digest('hex');

    // Duplicate prevention: the same image already attached at another slot.
    const files = uploads.exists ? uploads.data().files ?? {} : {};
    const duplicateOf = Object.entries(files)
      .find(([i, f]) => Number(i) !== body.index && f?.[`${body.variant}Sha256`] === sha256);
    if (duplicateOf) {
      return { ok: true, duplicate: true, index: Number(duplicateOf[0]) };
    }

    const path = `reports/${body.reportId}/${body.index}${body.variant === 'thumb' ? '-thumb' : ''}.${EXT[sniffed.type]}`;
    await getStorage().bucket().file(path).save(cleaned, {
      contentType: sniffed.type,
      resumable: false,
      metadata: {
        contentType: sniffed.type,
        // Paths are never reused (one report id, one slot), so a long private
        // cache is safe. Private: these are only ever served to the superadmin.
        cacheControl: 'private, max-age=31536000, immutable',
        metadata: { uploadedBy: user.uid, reportId: body.reportId },
      },
    });

    const slot = {
      ...(files[body.index] ?? {}),
      [`${body.variant}Path`]: path,
      [`${body.variant}Sha256`]: sha256,
      [`${body.variant}Bytes`]: cleaned.length,
      contentType: body.variant === 'full' ? sniffed.type : (files[body.index]?.contentType ?? sniffed.type),
      ...(body.width ? { width: body.width } : {}),
      ...(body.height ? { height: body.height } : {}),
    };

    await uploadsRef.set(
      {
        uid: user.uid,
        files: { [body.index]: slot },
        ...(uploads.exists ? {} : { createdAt: new Date() }),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    log.info('Report screenshot uploaded', { variant: body.variant, bytes: cleaned.length });
    return { ok: true, index: body.index, variant: body.variant, bytes: cleaned.length };
  },
});
