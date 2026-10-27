import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issuePass, verifyPass, PASS_LIFETIME_SECONDS } from '../../../api/_lib/checkinPass.js';
import { edgeLimitAllows, runInRequestContext } from '../../../api/_lib/requestContext.js';

/**
 * 002Fixes / 07 — the check-in pass: signed, short-lived, bound to one
 * session and number, and carrying no phone digits.
 */

const KEY = Buffer.alloc(32, 9).toString('base64');
const PHONE = '+254798765432';
const T = Date.parse('2026-10-27T16:00:00Z');
let saved;

beforeEach(() => { saved = process.env.APP_ENCRYPTION_KEY; process.env.APP_ENCRYPTION_KEY = KEY; });
afterEach(() => { if (saved === undefined) delete process.env.APP_ENCRYPTION_KEY; else process.env.APP_ENCRYPTION_KEY = saved; });

const ctx = { session: 'evening', phone: PHONE };

describe('issue and verify', () => {
  it('a pass verifies for its own session and number, for four hours', () => {
    const pass = issuePass({ ...ctx, now: T });
    expect(pass).toMatch(/^v1\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(verifyPass(pass, { ...ctx, now: T })).toBe(true);
    expect(verifyPass(pass, { ...ctx, now: T + (PASS_LIFETIME_SECONDS - 1) * 1000 })).toBe(true);
    expect(verifyPass(pass, { ...ctx, now: T + PASS_LIFETIME_SECONDS * 1000 })).toBe(false);
  });

  it('is refused for another number or another session', () => {
    const pass = issuePass({ ...ctx, now: T });
    expect(verifyPass(pass, { session: 'evening', phone: '+254798765431', now: T })).toBe(false);
    expect(verifyPass(pass, { session: 'morning', phone: PHONE, now: T })).toBe(false);
  });

  it('is refused if any character is changed, or the expiry is edited', () => {
    const pass = issuePass({ ...ctx, now: T });
    const last = pass.at(-1);
    expect(verifyPass(`${pass.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`, { ...ctx, now: T })).toBe(false);
    const [, exp, sig] = pass.split('.');
    expect(verifyPass(`v1.${Number(exp) + 3600}.${sig}`, { ...ctx, now: T })).toBe(false);
  });

  it('a pass dated beyond its lifetime (forged in the future) is refused', () => {
    const future = issuePass({ ...ctx, now: T + 10 * 3600_000 });
    expect(verifyPass(future, { ...ctx, now: T })).toBe(false);
  });

  it('malformed input is refused without throwing', () => {
    for (const bad of [undefined, null, '', 'v1', 'v2.1793030000.abc', 42, {}, `v1.1793030000.${'x'.repeat(500)}`]) {
      expect(verifyPass(bad, { ...ctx, now: T })).toBe(false);
    }
  });

  it('carries no phone digits', () => {
    const pass = issuePass({ ...ctx, now: T });
    for (let i = 0; i + 4 <= '98765432'.length; i += 1) expect(pass).not.toContain('98765432'.slice(i, i + 4));
  });

  it('without APP_ENCRYPTION_KEY no pass is issued and none verifies', () => {
    const pass = issuePass({ ...ctx, now: T });
    delete process.env.APP_ENCRYPTION_KEY;
    expect(issuePass({ ...ctx, now: T })).toBeNull();
    expect(verifyPass(pass, { ...ctx, now: T })).toBe(false);
  });

  it('a different key cannot verify it', () => {
    const pass = issuePass({ ...ctx, now: T });
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    expect(verifyPass(pass, { ...ctx, now: T })).toBe(false);
  });
});

describe('the edge limiter', () => {
  it('fails open with no binding, and with a binding that errors', async () => {
    expect(await edgeLimitAllows('pass:x')).toBe(true);
    const broken = { limit: vi.fn().mockRejectedValue(new Error('down')) };
    expect(await runInRequestContext({ passLimiter: broken }, () => edgeLimitAllows('pass:x'))).toBe(true);
  });

  it('follows the binding\'s answer', async () => {
    const limiter = { limit: vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false }) };
    const run = () => runInRequestContext({ passLimiter: limiter }, () => edgeLimitAllows('pass:abc'));
    expect(await run()).toBe(true);
    expect(await run()).toBe(false);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'pass:abc' });
  });
});
