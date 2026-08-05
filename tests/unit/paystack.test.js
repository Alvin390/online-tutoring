import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';

/**
 * Paystack helpers — Phase 03 D1/D4.
 *
 * Signature verification is the single control standing between an attacker and
 * a forged "payment succeeded" event, so it gets direct tests rather than being
 * exercised only through the handler.
 */

let paystack;
const SECRET = process.env.PAYSTACK_SECRET_KEY || "test-key";

beforeAll(async () => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  process.env.PAYSTACK_PLAN_BRONZE = 'PLN_bronze';
  process.env.PAYSTACK_PLAN_SILVER = 'PLN_silver';
  process.env.PAYSTACK_PLAN_GOLD = 'PLN_gold';
  paystack = await import('../../api/_lib/paystack.js');
});

const sign = (body, secret = SECRET) =>
  createHmac('sha512', secret).update(body).digest('hex');

describe('webhook signature verification', () => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { amount: 499900 } }));

  it('accepts a correctly signed body', () => {
    expect(paystack.verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(paystack.verifyWebhookSignature(body, sign(body, 'sk_test_wrong'))).toBe(false);
  });

  it('rejects when the body was altered after signing', () => {
    // The whole point: an attacker inflating the amount must invalidate it.
    const signature = sign(body);
    const tampered = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { amount: 1 } })
    );
    expect(paystack.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(paystack.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(paystack.verifyWebhookSignature(body, '')).toBe(false);
    expect(paystack.verifyWebhookSignature(body, null)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; safeCompare hashes first, so
    // this must return false rather than crash the handler into a 500.
    expect(() => paystack.verifyWebhookSignature(body, 'abc')).not.toThrow();
    expect(paystack.verifyWebhookSignature(body, 'abc')).toBe(false);
  });

  it('is sensitive to byte-level differences, not just content', () => {
    // Key order changes the raw bytes, so a re-serialised body fails. This is
    // exactly why the handler must read the raw stream, not req.body.
    const reordered = Buffer.from(
      JSON.stringify({ data: { amount: 499900 }, event: 'charge.success' })
    );
    expect(paystack.verifyWebhookSignature(reordered, sign(body))).toBe(false);
  });

  it('accepts a body containing unicode', () => {
    const unicode = Buffer.from(JSON.stringify({ event: 'charge.success', note: 'Ksh — ✓' }));
    expect(paystack.verifyWebhookSignature(unicode, sign(unicode))).toBe(true);
  });
});

describe('IP allowlist', () => {
  it('recognises every documented Paystack source IP', () => {
    for (const ip of ['52.31.139.75', '52.49.173.169', '52.214.14.220']) {
      expect(paystack.isPaystackIp(ip)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(paystack.isPaystackIp('1.2.3.4')).toBe(false);
    expect(paystack.isPaystackIp('52.31.139.76')).toBe(false);
    expect(paystack.isPaystackIp('')).toBe(false);
  });
});

describe('subunit conversion', () => {
  it('converts KES to cents', () => {
    expect(paystack.toSubunit(4999)).toBe(499900);
    expect(paystack.toSubunit(7499)).toBe(749900);
    expect(paystack.toSubunit(9999)).toBe(999900);
  });

  it('rounds rather than truncating, so no fraction is silently lost', () => {
    expect(paystack.toSubunit(10.005)).toBe(1001);
    expect(paystack.toSubunit(0.1 + 0.2)).toBe(30);
  });

  it('handles zero', () => {
    expect(paystack.toSubunit(0)).toBe(0);
  });
});

describe('server-side price table', () => {
  it('matches the agreed tier prices', () => {
    expect(paystack.TIER_PRICE_KES).toEqual({ bronze: 4999, silver: 7499, gold: 9999 });
  });

  it('resolves a plan code per tier', () => {
    expect(paystack.planCodeForTier('bronze')).toBe('PLN_bronze');
    expect(paystack.planCodeForTier('gold')).toBe('PLN_gold');
  });

  it('refuses an unknown tier', () => {
    expect(() => paystack.planCodeForTier('platinum')).toThrow();
  });

  it('refuses a tier whose plan code is not configured', () => {
    const saved = process.env.PAYSTACK_PLAN_SILVER;
    delete process.env.PAYSTACK_PLAN_SILVER;
    expect(() => paystack.planCodeForTier('silver')).toThrow();
    process.env.PAYSTACK_PLAN_SILVER = saved;
  });
});

describe('cron secret comparison', () => {
  it('compares in constant time and rejects a near-miss', async () => {
    const { safeCompare } = await import('../../api/_lib/crypto.js');
    const secret = randomBytes(32).toString('base64');
    expect(safeCompare(secret, secret)).toBe(true);
    expect(safeCompare(secret, `${secret}x`)).toBe(false);
    expect(safeCompare(secret, secret.slice(0, -1))).toBe(false);
  });
});
