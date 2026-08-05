import { describe, it, expect } from 'vitest';
import {
  toWaNumber,
  buildWaLink,
  maskForDisplay,
  preflight,
  estimateDuration,
  MAX_MESSAGE_LENGTH,
} from '@utils/waLink';

/**
 * wa.me link building — Phase 08 D5.
 */

describe('toWaNumber', () => {
  it('strips the plus and separators', () => {
    // wa.me/+254712345678 does not work. Digits only.
    expect(toWaNumber('+254712345678')).toEqual({ valid: true, digits: '254712345678' });
    expect(toWaNumber('+254 712 345 678').digits).toBe('254712345678');
    expect(toWaNumber('+254-712-345-678').digits).toBe('254712345678');
  });

  it('accepts a number given as a number', () => {
    expect(toWaNumber(254712345678).digits).toBe('254712345678');
  });

  it('rejects a local number with a leading zero', () => {
    // wa.me fails silently on these rather than erroring, so it is caught here.
    const result = toWaNumber('0712345678');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('country code');
  });

  it('rejects a number that is too short', () => {
    expect(toWaNumber('12345').valid).toBe(false);
  });

  it('rejects a number that is too long for E.164', () => {
    expect(toWaNumber('+1234567890123456').valid).toBe(false);
  });

  it('rejects empty and non-string input', () => {
    for (const bad of ['', '   ', null, undefined, {}, []]) {
      expect(toWaNumber(bad).valid, String(bad)).toBe(false);
    }
  });
});

describe('buildWaLink', () => {
  it('builds a click-to-chat URL', () => {
    const result = buildWaLink('+254712345678', 'Hello');
    expect(result.valid).toBe(true);
    expect(result.url).toBe('https://wa.me/254712345678?text=Hello');
  });

  it('encodes newlines, ampersands and emoji', () => {
    // Hand-building this URL is how messages get truncated at the first &.
    const result = buildWaLink('+254712345678', 'Line one\nMaths & Physics 🎓');
    expect(result.url).toContain('%0A');
    expect(result.url).toContain('%26');
    expect(result.url).not.toContain('\n');
    expect(decodeURIComponent(result.url.split('?text=')[1])).toBe('Line one\nMaths & Physics 🎓');
  });

  it('omits the text parameter when there is no message', () => {
    expect(buildWaLink('+254712345678', '').url).toBe('https://wa.me/254712345678');
  });

  it('rejects a message beyond WhatsApp&apos;s limit', () => {
    const result = buildWaLink('+254712345678', 'a'.repeat(MAX_MESSAGE_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('4096');
  });

  it('accepts a message at exactly the limit', () => {
    expect(buildWaLink('+254712345678', 'a'.repeat(MAX_MESSAGE_LENGTH)).valid).toBe(true);
  });

  it('propagates a bad number', () => {
    expect(buildWaLink('0712345678', 'Hi').valid).toBe(false);
  });
});

describe('maskForDisplay', () => {
  it('shows enough to recognise without printing the whole number', () => {
    expect(maskForDisplay('+254712345678')).toBe('+254 7•• ••• 678');
  });

  it('degrades gracefully on rubbish', () => {
    expect(maskForDisplay('123')).toBe('•••');
    expect(maskForDisplay(null)).toBe('•••');
  });
});

describe('preflight', () => {
  const student = (overrides) => ({ id: '+254712345678', studentName: 'Amina', ...overrides });

  it('separates sendable recipients from problems', () => {
    const { sendable, problems } = preflight([
      student(),
      student({ id: '0712345678', studentName: 'Bad number' }),
      student({ studentName: 'Opted out', whatsappOptOut: true }),
    ]);

    expect(sendable).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });

  it('excludes opted-out students before checking their number', () => {
    // Opt-out is a legal requirement under Kenya's Data Protection Act 2019,
    // not a nicety, so it wins over every other consideration.
    const { problems } = preflight([student({ whatsappOptOut: true })]);
    expect(problems[0].reason).toBe('opted_out');
  });

  it('explains why each number failed', () => {
    const { problems } = preflight([student({ id: '0712345678' })]);
    expect(problems[0].reason).toBe('invalid_number');
    expect(problems[0].message).toContain('country code');
  });

  it('falls back through phone, parentPhone and id', () => {
    expect(preflight([{ parentPhone: '+254712345678' }]).sendable).toHaveLength(1);
    expect(preflight([{ phone: '+254712345678' }]).sendable).toHaveLength(1);
  });

  it('handles an empty or missing list', () => {
    expect(preflight([]).sendable).toEqual([]);
    expect(preflight(undefined).sendable).toEqual([]);
  });
});

describe('estimateDuration', () => {
  it('gives an honest estimate up front', () => {
    // A teacher who knows a 34-student broadcast takes about three minutes is
    // not frustrated by it. One who expected instant is.
    expect(estimateDuration(5)).toBe('about 20 seconds');
    expect(estimateDuration(34)).toBe('about 2 minutes');
    expect(estimateDuration(15)).toBe('about 1 minute');
  });
});
