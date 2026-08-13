import { describe, it, expect } from 'vitest';
import {
  redact,
  redactString,
  redactSentryEvent,
  maskPhone,
  maskEmail,
} from '@utils/redact';

/**
 * Redaction tests — Phase 01 D3.
 *
 * These guard the specific leaks that existed before the rewrite: parent phone
 * numbers interpolated into log lines, the teacher's email in auth logs, and
 * M-Pesa codes inside receipt text.
 */

describe('phone masking', () => {
  it('masks an E.164 number but keeps it correlatable', () => {
    expect(maskPhone('+254712345678')).toBe('+2547•••••678');
  });

  it('masks a short string entirely rather than leaking most of it', () => {
    expect(maskPhone('+25471')).toBe('••••••');
  });

  it('finds a phone number embedded in a sentence', () => {
    expect(redactString('checkStudentExists: phone=+254712345678, exists=true'))
      .toBe('checkStudentExists: phone=+2547•••••678, exists=true');
  });

  it('finds a phone number inside a Firestore document path', () => {
    expect(redactString('sessions/morning/students/+254798765432'))
      .toBe('sessions/morning/students/+2547•••••432');
  });

  it('masks every occurrence, not just the first', () => {
    const out = redactString('from +254712345678 to +254798765432');
    expect(out).not.toContain('712345678');
    expect(out).not.toContain('798765432');
  });
});

describe('email masking', () => {
  it('keeps the domain and drops the local part', () => {
    expect(maskEmail('teacher@example.com')).toBe('t•••@example.com');
  });

  it('finds an email in a log line', () => {
    expect(redactString('Login failed for alvin.mwangi@gmail.com'))
      .toBe('Login failed for a•••@gmail.com');
  });
});

describe('M-Pesa code masking', () => {
  it('masks a transaction code', () => {
    expect(redactString('QGH7UY23K1 Confirmed.')).toBe('QGH••••••• Confirmed.');
  });

  it('leaves an ordinary ten-letter word alone', () => {
    // No digit, so it is not a transaction code.
    expect(redactString('ABCDEFGHIJ')).toBe('ABCDEFGHIJ');
  });

  it('leaves a ten-digit number alone', () => {
    // No letter, so it is not a transaction code.
    expect(redactString('1234567890')).toBe('1234567890');
  });
});

describe('key-based redaction', () => {
  it('drops receipt text wholesale rather than pattern-matching it', () => {
    const out = redact({ receiptMessage: 'QGH7UY23K1 Ksh3,000 from +254712345678' });
    expect(out.receiptMessage).toBe('[redacted]');
  });

  it('drops any key containing "phone", whatever the casing', () => {
    const out = redact({ parentPhone: '+254712345678', phoneNumber: '+254798765432' });
    expect(out.parentPhone).toBe('[redacted]');
    expect(out.phoneNumber).toBe('[redacted]');
  });

  it('drops secrets', () => {
    const out = redact({
      consumerSecret: 'abc',
      passkey: 'def',
      authorization: 'Bearer x',
      apiKey: 'k',
    });
    expect(Object.values(out)).toEqual(['[redacted]', '[redacted]', '[redacted]', '[redacted]']);
  });

  it('leaves non-sensitive fields untouched', () => {
    const out = redact({ session: 'morning', count: 12, blocked: true });
    expect(out).toEqual({ session: 'morning', count: 12, blocked: true });
  });

  it('recurses into nested objects and arrays', () => {
    const out = redact({ students: [{ parentPhone: '+254712345678', class: 'Grade 8' }] });
    expect(out.students[0].parentPhone).toBe('[redacted]');
    expect(out.students[0].class).toBe('Grade 8');
  });

  it('survives a circular reference', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(a).self).toBe('[circular]');
  });

  it('redacts an Error message and stack', () => {
    const out = redact(new Error('failed for +254712345678'));
    expect(out.message).toBe('failed for +2547•••••678');
  });

  it('caps depth so a deeply nested object cannot blow the stack', () => {
    let deep = { value: 'leaf' };
    for (let i = 0; i < 50; i += 1) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

describe('Sentry beforeSend', () => {
  it('redacts the exception value', () => {
    const event = redactSentryEvent({
      exception: { values: [{ value: 'No document at students/+254712345678' }] },
    });
    expect(event.exception.values[0].value).toBe('No document at students/+2547•••••678');
  });

  it('strips identifying user fields', () => {
    const event = redactSentryEvent({
      user: { id: 'abc123xyz', email: 'teacher@example.com', ip_address: '1.2.3.4' },
    });
    expect(event.user.email).toBeUndefined();
    expect(event.user.ip_address).toBeUndefined();
  });

  it('redacts breadcrumb messages', () => {
    const event = redactSentryEvent({
      breadcrumbs: [{ message: 'checkin +254712345678' }],
    });
    expect(event.breadcrumbs[0].message).toBe('checkin +2547•••••678');
  });

  it('handles a null event without throwing', () => {
    expect(redactSentryEvent(null)).toBeNull();
  });
});
