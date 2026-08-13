import { describe, it, expect } from 'vitest';
import {
  validateSlug,
  slugify,
  RESERVED_SLUGS,
  SLUG_PATTERN,
} from '@shared/constants/sessions';

/**
 * Session slugs — Phase 05 Part A.
 *
 * The slug is both the route segment and the Firestore document ID, so a bad
 * one is either an unreachable session or a collision with an app route.
 */

describe('validateSlug', () => {
  it('accepts simple lowercase slugs', () => {
    for (const slug of ['morning', 'evening', 'saturday-revision', 'grade8', 'a']) {
      expect(validateSlug(slug).valid, slug).toBe(true);
    }
  });

  it('lowercases what it accepts', () => {
    expect(validateSlug('Morning').slug).toBe('morning');
  });

  it('trims surrounding whitespace', () => {
    expect(validateSlug('  morning  ').slug).toBe('morning');
  });

  const rejected = [
    ['empty', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['leading hyphen', '-morning'],
    ['trailing hyphen', 'morning-'],
    ['a space inside', 'saturday revision'],
    ['an underscore', 'saturday_revision'],
    ['a slash — would break routing', 'a/b'],
    ['a dot', 'a.b'],
    ['uppercase-only symbols', '!!!'],
    ['too long', 'a'.repeat(41)],
    ['path traversal', '../dashboard'],
    ['a URL', 'https://evil.com'],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(validateSlug(value).valid).toBe(false);
    });
  }

  it('rejects every reserved slug', () => {
    for (const slug of RESERVED_SLUGS) {
      const result = validateSlug(slug);
      expect(result.valid, `expected "${slug}" to be reserved`).toBe(false);
      expect(result.error).toContain('reserved');
    }
  });

  it('rejects a reserved slug regardless of casing', () => {
    expect(validateSlug('Dashboard').valid).toBe(false);
    expect(validateSlug('LOGIN').valid).toBe(false);
  });

  it('accepts exactly 40 characters and rejects 41', () => {
    expect(validateSlug('a'.repeat(40)).valid).toBe(true);
    expect(validateSlug('a'.repeat(41)).valid).toBe(false);
  });
});

describe('slugify', () => {
  it('derives a slug from a display name', () => {
    expect(slugify('Saturday Revision')).toBe('saturday-revision');
    expect(slugify('Grade 8 — Maths')).toBe('grade-8-maths');
  });

  it('collapses repeated separators', () => {
    expect(slugify('A   B')).toBe('a-b');
    expect(slugify('A---B')).toBe('a-b');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  -Morning-  ')).toBe('morning');
  });

  it('never returns a reserved slug', () => {
    // Otherwise typing "Dashboard" as a session name would auto-fill an
    // unusable slug and the teacher would have to work out why.
    const result = slugify('Dashboard');
    expect(RESERVED_SLUGS).not.toContain(result);
    expect(validateSlug(result).valid).toBe(true);
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
  });

  it('always produces something validateSlug accepts, or nothing', () => {
    const names = ['Morning', 'Evening Class', 'Login', 'API', '  ', '日本語', 'A'.repeat(80)];
    for (const name of names) {
      const slug = slugify(name);
      if (slug) expect(validateSlug(slug).valid, `slugify(${name}) -> ${slug}`).toBe(true);
    }
  });
});

describe('client and server slug rules agree', () => {
  it('shares the same reserved list and pattern', async () => {
    const server = await import('../../api/_lib/sessions.js');

    // A slug reserved in the UI but accepted by the API would create a session
    // nobody can reach.
    expect([...server.RESERVED_SLUGS].sort()).toEqual([...RESERVED_SLUGS].sort());
    expect(server.SLUG_PATTERN.source).toBe(SLUG_PATTERN.source);
  });

  it('produces identical verdicts across a corpus', async () => {
    const server = await import('../../api/_lib/sessions.js');
    const corpus = ['morning', 'dashboard', '-bad', 'ok-slug', '', 'A'.repeat(41), 'api'];

    for (const slug of corpus) {
      expect(server.validateSlug(slug).valid, slug).toBe(validateSlug(slug).valid);
    }
  });
});
