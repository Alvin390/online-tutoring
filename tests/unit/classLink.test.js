import { describe, it, expect } from 'vitest';
import { parseClassLink, detectProvider, providerLabel } from '@utils/classLink';

/**
 * Class-link validation — Phase 04 Part B.
 *
 * The old check was `zoomLink.includes('zoom.us')`, and the result went
 * straight to `window.location.href`. Every rejection case below was previously
 * an open redirect.
 */

describe('rejects anything that is not a real class link', () => {
  const rejected = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['not a URL at all', 'zoom.us/j/123'],
    ['http, not https', 'http://zoom.us/j/123'],
    ['javascript: scheme', 'javascript:alert(1)'],
    ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
    ['file: scheme', 'file:///etc/passwd'],
  ];

  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseClassLink(input).valid).toBe(false);
    });
  }
});

describe('rejects hostnames that merely contain an allowed one', () => {
  // Each of these passed the old `includes('zoom.us')` check.
  const attacks = [
    ['zoom.us in the query string', 'https://evil.com/?x=zoom.us'],
    ['zoom.us in the path', 'https://evil.com/zoom.us/j/123'],
    ['zoom.us as a subdomain of an attacker domain', 'https://zoom.us.evil.com/j/123'],
    ['allowed host as a suffix', 'https://notzoom.us/j/123'],
    ['allowed host in userinfo', 'https://zoom.us@evil.com/j/123'],
    ['allowed host in the fragment', 'https://evil.com/#zoom.us'],
    ['meet.google.com as a subdomain of an attacker domain', 'https://meet.google.com.evil.com/x'],
    ['lookalike google host', 'https://meet-google.com/abc-defg-hij'],
    ['different google product', 'https://mail.google.com/abc'],
  ];

  for (const [label, url] of attacks) {
    it(`rejects ${label}`, () => {
      const result = parseClassLink(url);
      expect(result.valid).toBe(false);
    });
  }
});

describe('accepts genuine Zoom links', () => {
  const accepted = [
    'https://us02web.zoom.us/j/1234567890',
    'https://zoom.us/j/1234567890',
    'https://eu01web.zoom.us/j/123?pwd=abcdef',
    'https://my-company.zoom.us/j/999',
  ];

  for (const url of accepted) {
    it(`accepts ${url}`, () => {
      const result = parseClassLink(url);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('zoom');
    });
  }
});

describe('accepts genuine Google Meet links', () => {
  const accepted = [
    'https://meet.google.com/abc-defg-hij',
    'https://meet.google.com/lookup/abcdefghij',
  ];

  for (const url of accepted) {
    it(`accepts ${url}`, () => {
      const result = parseClassLink(url);
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('meet');
    });
  }
});

describe('normalisation', () => {
  it('trims surrounding whitespace', () => {
    expect(parseClassLink('  https://zoom.us/j/1  ').valid).toBe(true);
  });

  it('returns the re-serialised URL, not the raw input', () => {
    // What gets stored is what was validated.
    const result = parseClassLink('  https://zoom.us/j/1  ');
    expect(result.url).toBe('https://zoom.us/j/1');
  });

  it('is case-insensitive on the hostname', () => {
    expect(parseClassLink('https://ZOOM.US/j/1').valid).toBe(true);
    expect(parseClassLink('https://Meet.Google.Com/abc').provider).toBe('meet');
  });
});

describe('detectProvider', () => {
  it('names the provider of a valid link', () => {
    expect(detectProvider('https://zoom.us/j/1')).toBe('zoom');
    expect(detectProvider('https://meet.google.com/x')).toBe('meet');
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(detectProvider('nonsense')).toBeNull();
    expect(detectProvider(null)).toBeNull();
  });
});

describe('providerLabel', () => {
  it('names known providers', () => {
    expect(providerLabel('zoom')).toBe('Zoom');
    expect(providerLabel('meet')).toBe('Google Meet');
  });

  it('falls back to neutral copy for an unknown provider', () => {
    expect(providerLabel(null)).toBe('your class');
    expect(providerLabel('teams')).toBe('your class');
  });
});

describe('client and server implementations agree', () => {
  it('produces identical results across the whole corpus', async () => {
    const server = await import('../../api/_lib/classLink.js');

    const corpus = [
      'https://zoom.us/j/1',
      'https://us02web.zoom.us/j/1?pwd=x',
      'https://meet.google.com/abc-defg-hij',
      'http://zoom.us/j/1',
      'https://evil.com/?x=zoom.us',
      'https://zoom.us.evil.com/j/1',
      'https://notzoom.us/j/1',
      'javascript:alert(1)',
      '',
      'nonsense',
    ];

    for (const url of corpus) {
      const a = parseClassLink(url);
      const b = server.parseClassLink(url);
      expect(b.valid, `disagreement on: ${url}`).toBe(a.valid);
      if (a.valid) {
        expect(b.provider).toBe(a.provider);
        expect(b.url).toBe(a.url);
      }
    }
  });
});
