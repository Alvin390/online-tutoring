import { describe, it, expect } from 'vitest';
import { DEFAULT_FLAGS, FLAG_KEYS, resolveFlags, isEnabled } from '@shared/config/flags';

describe('feature flag resolution', () => {
  it('returns defaults when there is no remote document', () => {
    expect(resolveFlags(null)).toEqual(DEFAULT_FLAGS);
    expect(resolveFlags(undefined)).toEqual(DEFAULT_FLAGS);
  });

  it('overrides a known flag from the remote document', () => {
    expect(resolveFlags({ 'billing.enabled': true })['billing.enabled']).toBe(true);
  });

  it('drops unknown remote keys', () => {
    // A stale or hand-edited document must not resurrect a flag whose branch
    // has already been deleted from the code.
    const resolved = resolveFlags({ 'some.removedFlag': true });
    expect(resolved['some.removedFlag']).toBeUndefined();
    expect(Object.keys(resolved)).toEqual(FLAG_KEYS);
  });

  it('ignores a non-boolean value rather than coercing it', () => {
    expect(resolveFlags({ 'billing.enabled': 'true' })['billing.enabled']).toBe(false);
    expect(resolveFlags({ 'billing.enabled': 1 })['billing.enabled']).toBe(false);
  });

  it('defaults every gated feature to off', () => {
    const gated = FLAG_KEYS.filter((k) => k !== 'auth.legacyStudentRead');
    for (const key of gated) {
      expect(DEFAULT_FLAGS[key]).toBe(false);
    }
  });

  it('defaults legacyStudentRead ON so existing students can still check in', () => {
    // If this were off while auth.studentIdentity is also off, every student
    // would be locked out of check-in entirely.
    expect(DEFAULT_FLAGS['auth.legacyStudentRead']).toBe(true);
    expect(DEFAULT_FLAGS['auth.studentIdentity']).toBe(false);
  });

  it('isEnabled falls back to defaults for a null flag map', () => {
    expect(isEnabled(null, 'billing.enabled')).toBe(false);
    expect(isEnabled(null, 'auth.legacyStudentRead')).toBe(true);
  });
});
