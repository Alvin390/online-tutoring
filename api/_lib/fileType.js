/**
 * File type verification by MAGIC BYTES — Phase 08 D1.
 *
 * The declared `Content-Type` is attacker-controlled. A `.exe` renamed to
 * `.pdf` and uploaded with `Content-Type: application/pdf` passes every check
 * that trusts the header, and then sits on a public Storage URL that the
 * teacher is about to WhatsApp to thirty parents.
 *
 * So the bytes decide. The declared type is used only to reject early and
 * cheaply; the signature below is the actual control.
 */

export const ALLOWED_TYPES = {
  'application/pdf': { ext: 'pdf', label: 'PDF' },
  'image/jpeg': { ext: 'jpg', label: 'JPEG image' },
  'image/png': { ext: 'png', label: 'PNG image' },
  'image/webp': { ext: 'webp', label: 'WebP image' },
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const SIGNATURES = [
  { type: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

function matches(buffer, signature) {
  if (buffer.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, i) => buffer[signature.offset + i] === byte);
}

/**
 * WebP is `RIFF....WEBP` — a four-byte length sits between the two markers, so
 * it cannot be expressed as one contiguous signature.
 */
function isWebp(buffer) {
  if (buffer.length < 12) return false;
  return (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 // RIFF
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50 // WEBP
  );
}

/**
 * @returns {{valid: true, type: string, ext: string}
 *          |{valid: false, error: string}}
 */
export function sniffFileType(buffer, declaredType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, error: 'The file is empty.' };
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { valid: false, error: 'Files must be 10 MB or smaller.' };
  }

  let detected = null;
  for (const signature of SIGNATURES) {
    if (matches(buffer, signature)) {
      detected = signature.type;
      break;
    }
  }
  if (!detected && isWebp(buffer)) detected = 'image/webp';

  if (!detected) {
    return {
      valid: false,
      error: 'That file type is not supported. Use a PDF, JPEG, PNG or WebP.',
    };
  }

  // A mismatch between the claim and the content is not a formatting quirk —
  // it is either a broken client or a deliberate attempt to smuggle something
  // past the allowlist. Refused either way.
  if (declaredType && declaredType !== detected) {
    return {
      valid: false,
      error: 'The file contents do not match its type. Please re-export and try again.',
    };
  }

  return { valid: true, type: detected, ext: ALLOWED_TYPES[detected].ext };
}

/**
 * Strips EXIF from a JPEG by dropping every APPn marker segment.
 *
 * A photo taken on a phone carries GPS coordinates, the device model, and
 * often the owner's name. A teacher photographing a worksheet on their kitchen
 * table has no idea they are about to broadcast their home coordinates to
 * thirty parents, and would be appalled to learn it.
 *
 * Implemented directly rather than with `sharp` or `piexifjs`: sharp is a
 * ~30 MB native binary that would dominate the serverless bundle, and this is
 * a marker walk over a well-specified container.
 *
 * PNG and WebP can also carry metadata but rarely do from a camera; their
 * chunks are left intact so the image is not corrupted by a partial rewrite.
 */
export function stripJpegMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return buffer;
  if (!(buffer[0] === 0xff && buffer[1] === 0xd8)) return buffer; // not a JPEG

  const output = [Buffer.from([0xff, 0xd8])]; // SOI
  let offset = 2;

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) break;

    const marker = buffer[offset + 1];

    // Start of Scan: everything after this is entropy-coded image data. Copy
    // the remainder verbatim and stop parsing.
    if (marker === 0xda) {
      output.push(buffer.subarray(offset));
      break;
    }

    // Markers without a length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      output.push(buffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    if (offset + 4 > buffer.length) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;

    const isAppSegment = marker >= 0xe0 && marker <= 0xef; // APP0–APP15: EXIF, XMP, ICC
    const isComment = marker === 0xfe;

    if (!isAppSegment && !isComment) {
      output.push(buffer.subarray(offset, offset + 2 + length));
    }

    offset += 2 + length;
  }

  return Buffer.concat(output);
}

/**
 * Makes a filename safe for a Storage path and for a URL.
 *
 * Prefixed with a random token so URLs are not enumerable — otherwise
 * `/whatsapp/{campaign}/worksheet.pdf` is guessable, and every document the
 * teacher has ever sent becomes browsable by anyone who works that out.
 */
export function sanitiseFilename(filename, randomToken) {
  const raw = String(filename ?? 'file');

  // Basename only: strips both slash flavours, so `../../etc/passwd` and
  // `..\\..\\windows` both collapse to a leaf name.
  const base = raw.split(/[/\\]/).pop() ?? 'file';

  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+/, '')
    .slice(0, 80);

  const safe = cleaned || 'file';
  return randomToken ? `${randomToken}_${safe}` : safe;
}
