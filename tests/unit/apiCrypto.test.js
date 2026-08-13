import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * Serverless crypto primitives — Phase 01 D5.
 *
 * These protect the Daraja credentials from Phase 09 (which move real money out
 * of a real till) and the Paystack webhook signature check from Phase 03. Both
 * are places where a subtle mistake is silent, so they get direct tests rather
 * than being exercised only through a handler.
 */

let crypto;

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  crypto = await import('../../api/_lib/crypto.js');
});

describe('AES-256-GCM envelope encryption', () => {
  it('round-trips a secret', () => {
    const secret = 'daraja-consumer-secret-value';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('round-trips unicode and long values', () => {
    const secret = 'kΩey-🔐-'.repeat(200);
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('carries a version tag so keys can be rotated', () => {
    expect(crypto.encrypt('x').startsWith('v1.')).toBe(true);
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const box = crypto.encrypt('sensitive');
    const parts = box.split('.');
    // Flip the last character of the ciphertext segment.
    const last = parts[3];
    parts[3] = last.slice(0, -1) + (last.slice(-1) === 'A' ? 'B' : 'A');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a stripped auth tag', () => {
    const parts = crypto.encrypt('sensitive').split('.');
    parts[2] = Buffer.alloc(16).toString('base64');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => crypto.decrypt('not-an-envelope')).toThrow('Malformed ciphertext envelope');
  });

  it('rejects a key of the wrong length', async () => {
    const original = process.env.APP_ENCRYPTION_KEY;
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => crypto.encrypt('x')).toThrow(/32 bytes/);
    process.env.APP_ENCRYPTION_KEY = original;
  });
});

describe('safeCompare', () => {
  it('is true for equal strings', () => {
    expect(crypto.safeCompare('abc', 'abc')).toBe(true);
  });

  it('is false for different strings of equal length', () => {
    expect(crypto.safeCompare('abc', 'abd')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    // timingSafeEqual throws on a length mismatch, and that throw is itself a
    // timing signal. Hashing both sides first is what makes this safe.
    expect(() => crypto.safeCompare('abc', 'abcdefghijkl')).not.toThrow();
    expect(crypto.safeCompare('abc', 'abcdefghijkl')).toBe(false);
  });
});

describe('randomNumericCode', () => {
  it('produces a 6-digit string', () => {
    expect(crypto.randomNumericCode(6)).toMatch(/^\d{6}$/);
  });

  it('pads short values so every code is the same length', () => {
    const codes = Array.from({ length: 300 }, () => crypto.randomNumericCode(6));
    expect(codes.every((c) => c.length === 6)).toBe(true);
  });

  it('does not repeat trivially', () => {
    const codes = new Set(Array.from({ length: 200 }, () => crypto.randomNumericCode(6)));
    expect(codes.size).toBeGreaterThan(150);
  });
});

describe('server-side redaction matches the client copy', () => {
  it('masks a phone identically in both implementations', async () => {
    const server = await import('../../api/_lib/log.js');
    const client = await import('@utils/redact');

    const input = 'student +254712345678 checked in';
    expect(server.redactString(input)).toBe(client.redactString(input));
    expect(server.maskPhone('+254712345678')).toBe(client.maskPhone('+254712345678'));
  });

  it('drops the same sensitive keys in both implementations', async () => {
    const server = await import('../../api/_lib/log.js');
    const client = await import('@utils/redact');

    const input = { parentPhone: '+254712345678', receiptMessage: 'x', session: 'morning' };
    expect(server.redact(input)).toEqual(client.redact(input));
  });
});
