// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

/**
 * Caller IP resolution — Phase 12 D8.
 *
 * Two IP allowlists depend on this function, and one of them
 * (api/daraja/callback/[secret].js) is the PRIMARY control on an unsigned
 * webhook that credits real money. Getting the header precedence wrong either
 * lets a caller choose the IP we check, or returns 'unknown' and breaks every
 * genuine callback.
 */

let clientIp;
let isSafaricomIp;
let safaricomIps;

beforeAll(async () => {
  ({ clientIp } = await import('../../api/_lib/rateLimit.js'));
  ({ isSafaricomIp, safaricomIps } = await import('../../api/_lib/daraja.js'));
});

afterEach(() => {
  delete process.env.DARAJA_CALLBACK_IPS;
});

const req = (headers, socket) => ({ headers, socket });

describe('clientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '196.201.214.200' }))).toBe('196.201.214.200');
  });

  it('ignores a spoofed X-Forwarded-For when Cloudflare set the real one', () => {
    // Cloudflare APPENDS to any client-supplied X-Forwarded-For, so its
    // leftmost entry is attacker-controlled. CF-Connecting-IP is set at the
    // edge and stripped from client input, so it must win.
    const ip = clientIp(req({
      'cf-connecting-ip': '196.201.214.200',
      'x-forwarded-for': '1.2.3.4, 196.201.214.200',
    }));

    expect(ip).toBe('196.201.214.200');
  });

  it('falls back to X-Forwarded-For when Cloudflare is not in front', () => {
    // Keeps wrangler dev, the emulator suites and any other proxy working.
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('handles X-Forwarded-For arriving as an array', () => {
    expect(clientIp(req({ 'x-forwarded-for': ['203.0.113.7'] }))).toBe('203.0.113.7');
  });

  it('falls back to the socket address, then to a sentinel', () => {
    expect(clientIp(req({}, { remoteAddress: '127.0.0.1' }))).toBe('127.0.0.1');
    expect(clientIp(req({}))).toBe('unknown');
  });

  it('never returns a value that would pass an allowlist by accident', () => {
    // 'unknown' must not be a member of any allowlist.
    expect(isSafaricomIp(clientIp(req({})))).toBe(false);
    expect(isSafaricomIp('')).toBe(false);
    expect(isSafaricomIp(undefined)).toBe(false);
  });
});

describe('safaricomIps', () => {
  it('is read at call time, not at module load', () => {
    // On Workers process.env is populated lazily, so a module-scope read could
    // miss an operator's override of the primary control on an unsigned webhook.
    process.env.DARAJA_CALLBACK_IPS = '10.0.0.1,10.0.0.2';
    expect(safaricomIps()).toEqual(['10.0.0.1', '10.0.0.2']);

    delete process.env.DARAJA_CALLBACK_IPS;
    expect(safaricomIps()).toContain('196.201.214.200');
  });

  it('tolerates whitespace and trailing commas', () => {
    process.env.DARAJA_CALLBACK_IPS = ' 10.0.0.1 , 10.0.0.2 ,';
    expect(safaricomIps()).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('falls back to the defaults rather than emptying the allowlist', () => {
    // An empty allowlist would reject everything (fail closed, breaking real
    // callbacks) — and a bug that inverted the check would open it to all.
    // Neither is an acceptable result of a stray comma in an env var.
    process.env.DARAJA_CALLBACK_IPS = '  ,  ';
    expect(safaricomIps()).toContain('196.201.214.200');

    process.env.DARAJA_CALLBACK_IPS = '';
    expect(safaricomIps()).toContain('196.201.214.200');
  });

  it('honours an override exclusively', () => {
    process.env.DARAJA_CALLBACK_IPS = '10.0.0.1';
    expect(isSafaricomIp('10.0.0.1')).toBe(true);
    // The published defaults must NOT remain allowed once overridden, or the
    // override cannot be used to narrow the list.
    expect(isSafaricomIp('196.201.214.200')).toBe(false);
  });
});
