import { describe, it, expect } from 'vitest';
import { buildMimeMessage, encodeHeaderValue, toBase64Url } from '../../../api/_lib/gmail.js';
import { responseDueAt, formatReportNumber } from '../../../api/_lib/reports.js';

/**
 * Phase 13 / 06 — the pure parts of report email: MIME building (what Gmail is
 * given to send) and the response-deadline arithmetic the disclaimers promise.
 */

const decodeB64 = (s) => Buffer.from(s.replace(/\r\n/g, ''), 'base64').toString('utf8');

describe('encodeHeaderValue', () => {
  it('leaves plain ASCII alone', () => {
    expect(encodeHeaderValue('[Bug] BUG-0007 · Blocking')).not.toBe('[Bug] BUG-0007 · Blocking'); // "·" is not ASCII
    expect(encodeHeaderValue('Plain subject')).toBe('Plain subject');
  });

  it('RFC 2047-encodes non-ASCII (emoji, Zoë)', () => {
    const encoded = encodeHeaderValue('Zoë can’t join 😢');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8')).toBe('Zoë can’t join 😢');
  });

  it('neutralises header injection (CR/LF removed)', () => {
    const value = encodeHeaderValue('Hi\r\nBcc: attacker@example.com');
    expect(value).not.toMatch(/[\r\n]/);
  });
});

describe('buildMimeMessage', () => {
  const message = buildMimeMessage({
    from: 'alerts@example.com',
    fromName: 'Online Tutoring Alerts',
    to: 'owner@example.com',
    replyTo: 'teacher@example.com',
    subject: '[Bug] BUG-0001 · Blocking · Zoë cannot join',
    text: 'Plain body with Zoë',
    html: '<p>HTML body with Zoë</p>',
  });

  it('has the headers Gmail and spam filters expect', () => {
    const [headers] = message.split('\r\n\r\n');
    expect(headers).toMatch(/^From: Online Tutoring Alerts <alerts@example\.com>$/m);
    expect(headers).toMatch(/^To: owner@example\.com$/m);
    expect(headers).toMatch(/^Reply-To: teacher@example\.com$/m);
    expect(headers).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(headers).toMatch(/^MIME-Version: 1\.0$/m);
    expect(headers).toMatch(/^Content-Type: multipart\/alternative; boundary="([^"]+)"$/m);
  });

  it('carries a text part and an HTML part, both UTF-8', () => {
    const boundary = /boundary="([^"]+)"/.exec(message)[1];
    const parts = message.split(`--${boundary}`).slice(1, -1);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/Content-Type: text\/plain; charset=UTF-8/);
    expect(parts[1]).toMatch(/Content-Type: text\/html; charset=UTF-8/);
    expect(decodeB64(parts[0].split('\r\n\r\n')[1])).toBe('Plain body with Zoë');
    expect(decodeB64(parts[1].split('\r\n\r\n')[1])).toBe('<p>HTML body with Zoë</p>');
    expect(message.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('refuses an injected address', () => {
    expect(() => buildMimeMessage({ from: 'a@b.c', to: 'x@y.z\r\nBcc: e@v.il', subject: 's', text: 't', html: 'h' })).toThrow(/address/);
  });
});

describe('toBase64Url', () => {
  it('is URL-safe and unpadded', () => {
    const out = toBase64Url('???>>>~~~');
    expect(out).not.toMatch(/[+/=]/);
    expect(Buffer.from(out.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).toBe('???>>>~~~');
  });
});

describe('responseDueAt (the promise in the disclaimers)', () => {
  const nairobi = (iso) => new Date(`${iso}+03:00`).getTime();
  const asNairobi = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 16);

  it('bugs: 36 hours', () => {
    expect(responseDueAt('bug', nairobi('2026-10-16T10:00:00')) - nairobi('2026-10-16T10:00:00')).toBe(36 * 3600_000);
  });

  it('features: 3 working days — Friday 17:00 → Wednesday 17:00', () => {
    expect(asNairobi(responseDueAt('feature', nairobi('2026-10-16T17:00:00')))).toBe('2026-10-21T17:00');
  });

  it('features submitted at the weekend count from Monday', () => {
    expect(asNairobi(responseDueAt('feature', nairobi('2026-10-17T10:00:00')))).toBe('2026-10-21T10:00');
    expect(asNairobi(responseDueAt('feature', nairobi('2026-10-18T22:00:00')))).toBe('2026-10-21T22:00');
  });

  it('features on a Tuesday land on Friday', () => {
    expect(asNairobi(responseDueAt('feature', nairobi('2026-10-13T09:30:00')))).toBe('2026-10-16T09:30');
  });
});

describe('formatReportNumber', () => {
  it('pads and prefixes by type', () => {
    expect(formatReportNumber('bug', 7)).toBe('BUG-0007');
    expect(formatReportNumber('feature', 3)).toBe('FR-0003');
    expect(formatReportNumber('bug', 12345)).toBe('BUG-12345');
  });
});

describe('scripts/gmailAuth.js consent URL', () => {
  it('asks for gmail.send only, offline, with PKCE on a loopback redirect', async () => {
    const { buildConsentUrl, makePkce, GMAIL_SEND_SCOPE } = await import('../../../scripts/gmailAuth.js');
    const { verifier, challenge } = makePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(buildConsentUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555/callback', challenge, state: 's1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555/callback', response_type: 'code',
      scope: GMAIL_SEND_SCOPE, access_type: 'offline', prompt: 'consent',
      code_challenge: challenge, code_challenge_method: 'S256', state: 's1',
    });
    expect(GMAIL_SEND_SCOPE).toBe('https://www.googleapis.com/auth/gmail.send');
  });
});
