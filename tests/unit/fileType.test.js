import { describe, it, expect } from 'vitest';
import {
  sniffFileType,
  stripJpegMetadata,
  sanitiseFilename,
  MAX_UPLOAD_BYTES,
} from '../../api/_lib/fileType.js';

/**
 * Upload verification — Phase 08 D1.
 *
 * The declared Content-Type is attacker-controlled. These tests exist because
 * an accepted file lands on a Storage URL the teacher is about to WhatsApp to
 * thirty parents.
 */

const pdf = (extra = []) => Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, ...extra]);
const jpeg = (extra = []) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...extra]);
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = () =>
  Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('sniffFileType — accepts genuine files', () => {
  it('accepts a PDF', () => {
    expect(sniffFileType(pdf(), 'application/pdf')).toMatchObject({
      valid: true,
      type: 'application/pdf',
      ext: 'pdf',
    });
  });

  it('accepts JPEG, PNG and WebP', () => {
    expect(sniffFileType(jpeg(), 'image/jpeg').valid).toBe(true);
    expect(sniffFileType(png(), 'image/png').valid).toBe(true);
    expect(sniffFileType(webp(), 'image/webp').valid).toBe(true);
  });

  it('accepts a file with no declared type, deciding from the bytes', () => {
    expect(sniffFileType(pdf()).type).toBe('application/pdf');
  });
});

describe('sniffFileType — rejects smuggled files', () => {
  it('rejects an executable renamed to .pdf', () => {
    // MZ header — a Windows executable claiming to be a PDF.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const result = sniffFileType(exe, 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('rejects a real PDF declared as an image', () => {
    // A mismatch is either a broken client or a deliberate smuggling attempt.
    const result = sniffFileType(pdf(), 'image/png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('do not match');
  });

  it('rejects a shell script', () => {
    expect(sniffFileType(Buffer.from('#!/bin/sh\nrm -rf /'), 'application/pdf').valid).toBe(false);
  });

  it('rejects an SVG, which can carry script', () => {
    expect(sniffFileType(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml').valid)
      .toBe(false);
  });

  it('rejects an HTML file', () => {
    expect(sniffFileType(Buffer.from('<html><script>alert(1)</script>'), 'text/html').valid)
      .toBe(false);
  });

  it('rejects an empty file', () => {
    expect(sniffFileType(Buffer.alloc(0), 'application/pdf').valid).toBe(false);
  });

  it('rejects a file over 10 MB', () => {
    const oversized = Buffer.concat([pdf(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const result = sniffFileType(oversized, 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10 MB');
  });

  it('rejects a non-buffer', () => {
    expect(sniffFileType('not a buffer', 'application/pdf').valid).toBe(false);
    expect(sniffFileType(null).valid).toBe(false);
  });

  it('rejects a truncated WebP header', () => {
    expect(sniffFileType(Buffer.from([0x52, 0x49, 0x46, 0x46]), 'image/webp').valid).toBe(false);
  });
});

describe('stripJpegMetadata', () => {
  /** Builds a JPEG with an APP1 (EXIF) segment carrying GPS-looking bytes. */
  function jpegWithExif() {
    const payload = Buffer.from('Exif\0\0GPSLatitude-1.2921GPSLongitude36.8219');
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1]),
      (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(payload.length + 2, 0);
        return b;
      })(),
      payload,
    ]);
    return Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      app1,
      Buffer.from([0xff, 0xda]), // SOS
      Buffer.from([0x00, 0x0c, 0xaa, 0xbb, 0xcc]), // image data
    ]);
  }

  it('removes GPS coordinates from a camera photo', () => {
    // A teacher photographing a worksheet on their kitchen table has no idea
    // they are about to broadcast their home coordinates to thirty parents.
    const original = jpegWithExif();
    expect(original.includes(Buffer.from('GPSLatitude'))).toBe(true);

    const stripped = stripJpegMetadata(original);
    expect(stripped.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(stripped.includes(Buffer.from('Exif'))).toBe(false);
  });

  it('keeps the file a valid JPEG', () => {
    const stripped = stripJpegMetadata(jpegWithExif());
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect(sniffFileType(stripped, 'image/jpeg').valid).toBe(true);
  });

  it('preserves the image data after the scan marker', () => {
    const stripped = stripJpegMetadata(jpegWithExif());
    expect(stripped.includes(Buffer.from([0xaa, 0xbb, 0xcc]))).toBe(true);
  });

  it('leaves a non-JPEG untouched', () => {
    const original = png();
    expect(stripJpegMetadata(original)).toEqual(original);
  });

  it('does not throw on a truncated or malformed JPEG', () => {
    expect(() => stripJpegMetadata(Buffer.from([0xff, 0xd8]))).not.toThrow();
    expect(() => stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).not.toThrow();
    expect(() => stripJpegMetadata(Buffer.alloc(0))).not.toThrow();
    expect(() => stripJpegMetadata(null)).not.toThrow();
  });
});

describe('sanitiseFilename', () => {
  it('keeps an ordinary name readable', () => {
    expect(sanitiseFilename('Week 3 Worksheet.pdf')).toBe('Week-3-Worksheet.pdf');
  });

  it('defeats path traversal in both slash flavours', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('..\\..\\windows\\system32')).toBe('system32');
  });

  it('strips leading dots so no hidden file is created', () => {
    expect(sanitiseFilename('.htaccess')).toBe('htaccess');
  });

  it('collapses repeated dots', () => {
    expect(sanitiseFilename('a...b.pdf')).toBe('a.b.pdf');
  });

  it('removes characters that break a URL or a path', () => {
    expect(sanitiseFilename('re:port?<>|"*.pdf')).toBe('report.pdf');
  });

  it('prefixes a random token so URLs are not enumerable', () => {
    // Without this, /whatsapp/{campaign}/worksheet.pdf is guessable and every
    // document ever sent becomes browsable.
    expect(sanitiseFilename('worksheet.pdf', 'a1b2c3')).toBe('a1b2c3_worksheet.pdf');
  });

  it('caps the length', () => {
    expect(sanitiseFilename(`${'a'.repeat(200)}.pdf`).length).toBeLessThanOrEqual(80);
  });

  it('always returns something usable', () => {
    expect(sanitiseFilename('')).toBe('file');
    expect(sanitiseFilename(null)).toBe('file');
    expect(sanitiseFilename('???')).toBe('file');
  });
});
