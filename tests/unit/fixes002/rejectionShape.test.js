import { describe, it, expect, vi, afterEach } from 'vitest';
import { validate, valueShape, z, phoneSchema } from '../../../api/_lib/validate.js';
import { sendError, tooManyRequests } from '../../../api/_lib/errors.js';
import { createLogger } from '../../../api/_lib/log.js';

/**
 * 002Fixes / 02 — a rejected request's log line says what was wrong with the
 * value (its shape) and which limiter refused, and never carries the value.
 */

afterEach(() => vi.restoreAllMocks());

const schema = z.object({ session: z.string(), phone: phoneSchema }).strict();

/** Runs validate → sendError with a capturing logger; returns [response body, log line]. */
function rejectAndLog(body) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let err;
  try { validate(schema, body); } catch (e) { err = e; }
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; } };
  sendError(res, err, createLogger('test'));
  return [res, JSON.parse(warn.mock.calls.at(-1)[0])];
}

describe('valueShape', () => {
  it('describes a value by kind, length and form', () => {
    expect(valueShape('')).toEqual({ kind: 'empty', len: 0 });
    expect(valueShape(undefined)).toEqual({ kind: 'missing' });
    expect(valueShape(null)).toEqual({ kind: 'null' });
    expect(valueShape(712345678)).toEqual({ kind: 'number' });
    expect(valueShape(['x'])).toEqual({ kind: 'array' });
    expect(valueShape('0712345678')).toEqual({ kind: 'string', len: 10, plus: false, digits: 10, space: false, trunk0: false });
    expect(valueShape(' +254 712 345 678')).toMatchObject({ plus: false, digits: 12, space: true });
    expect(valueShape('+2540712345678')).toMatchObject({ plus: true, digits: 13, trunk0: true });
  });
});

describe('the rejection log line', () => {
  it('an empty phone (the 26 Oct case) logs field, issue and shape; the response is unchanged', () => {
    const [res, line] = rejectAndLog({ session: 'evening', phone: '' });
    expect(res.code).toBe(400);
    expect(res.body).toEqual({ error: { code: 'validation_failed', message: 'phone: must be a valid international phone number, e.g. +254712345678' } });
    expect(line.meta.detail).toEqual({ field: 'phone', issue: 'invalid_format', kind: 'empty', len: 0 });
  });

  it('a missing field is logged as missing', () => {
    const [, line] = rejectAndLog({ session: 'evening' });
    expect(line.meta.detail).toMatchObject({ field: 'phone', kind: 'missing' });
  });

  it('never logs the digits of a rejected number', () => {
    for (const bad of ['0798765432', ' +254 798 765 432', '+2540798765432', '+254798765432x']) {
      const [, line] = rejectAndLog({ session: 'evening', phone: bad });
      const text = JSON.stringify(line);
      for (let i = 0; i + 4 <= '98765432'.length; i += 1) {
        expect(text).not.toContain('98765432'.slice(i, i + 4));
      }
      expect(line.meta.detail.field).toBe('phone');
    }
  });

  it('a rate-limit refusal logs which limiter refused, with no key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = tooManyRequests('Too many requests.', 1820);
    err.detail = { bucket: 'student_checkin_phone', limit: 20, windowSeconds: 3600, retryAfter: 1820 };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status() { return this; }, json() {} };
    sendError(res, err, createLogger('test'));
    expect(JSON.parse(warn.mock.calls[0][0]).meta.detail).toEqual({ bucket: 'student_checkin_phone', limit: 20, windowSeconds: 3600, retryAfter: 1820 });
    expect(res.headers['Retry-After']).toBe('1820');
  });
});
