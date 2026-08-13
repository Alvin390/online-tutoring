import { describe, it, expect } from 'vitest';
import {
  assertIntegerKes,
  fromDarajaAmount,
  normaliseDarajaPhone,
  parseDarajaTimestamp,
  signedAmount,
  LEDGER_SIGN,
} from '../../api/_lib/money.js';

/**
 * Money primitives — Phase 06.
 *
 * The Daraja cases are checked against the shapes in daraja_docs.txt so that
 * Phase 09 inherits working conversions rather than discovering them against a
 * live till.
 */

describe('assertIntegerKes', () => {
  it('accepts whole shillings', () => {
    expect(assertIntegerKes(3000)).toBe(3000);
    expect(assertIntegerKes(0)).toBe(0);
    expect(assertIntegerKes(-1500)).toBe(-1500);
  });

  it('rejects a fractional amount', () => {
    // Every float in a money path is a rounding bug waiting for a big enough
    // ledger.
    expect(() => assertIntegerKes(3000.5)).toThrow(RangeError);
    expect(() => assertIntegerKes(0.1 + 0.2)).toThrow(RangeError);
  });

  it('rejects non-numbers', () => {
    expect(() => assertIntegerKes('3000')).toThrow(TypeError);
    expect(() => assertIntegerKes(null)).toThrow(TypeError);
    expect(() => assertIntegerKes(undefined)).toThrow(TypeError);
    expect(() => assertIntegerKes(NaN)).toThrow(TypeError);
    expect(() => assertIntegerKes(Infinity)).toThrow(TypeError);
  });

  it('rejects values beyond safe integer range', () => {
    expect(() => assertIntegerKes(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('fromDarajaAmount', () => {
  // daraja_docs.txt:302 types Amount as Decimal, with samples 1.0 and 10500.00.
  it('converts the documented decimal samples', () => {
    expect(fromDarajaAmount(1.0)).toBe(1);
    expect(fromDarajaAmount(10500.0)).toBe(10500);
    expect(fromDarajaAmount(3000)).toBe(3000);
  });

  it('accepts a string amount, which sandbox sometimes returns', () => {
    expect(fromDarajaAmount('1500.00')).toBe(1500);
  });

  it('rounds rather than truncating', () => {
    // Truncating loses money belonging to the student.
    expect(fromDarajaAmount(1500.6)).toBe(1501);
    expect(fromDarajaAmount(1500.4)).toBe(1500);
  });

  it('rejects a negative amount', () => {
    expect(() => fromDarajaAmount(-100)).toThrow(RangeError);
  });

  it('rejects rubbish', () => {
    expect(() => fromDarajaAmount('abc')).toThrow(TypeError);
    expect(() => fromDarajaAmount(null)).toThrow(TypeError);
  });
});

describe('normaliseDarajaPhone', () => {
  // daraja_docs.txt:306 shows PhoneNumber as 254722000000 — no plus sign —
  // while every student document here is keyed +254722000000. Without this the
  // callback looks up a student that appears not to exist and drops a real
  // payment.
  it('adds the plus to a 254 number', () => {
    expect(normaliseDarajaPhone(254722000000)).toBe('+254722000000');
    expect(normaliseDarajaPhone('254708374149')).toBe('+254708374149');
  });

  it('converts a local 07xx number', () => {
    expect(normaliseDarajaPhone('0722000000')).toBe('+254722000000');
  });

  it('leaves an already-normalised number alone', () => {
    expect(normaliseDarajaPhone('+254722000000')).toBe('+254722000000');
  });

  it('strips spaces and separators', () => {
    expect(normaliseDarajaPhone('254 722 000 000')).toBe('+254722000000');
    expect(normaliseDarajaPhone('254-722-000-000')).toBe('+254722000000');
  });

  it('returns null for empty input', () => {
    expect(normaliseDarajaPhone('')).toBeNull();
    expect(normaliseDarajaPhone(null)).toBeNull();
  });
});

describe('parseDarajaTimestamp', () => {
  // daraja_docs.txt:305 — YYYYMMDDHHmmss as a NUMBER. `new Date()` on it
  // yields 1970.
  it('parses the documented sample', () => {
    const parsed = parseDarajaTimestamp(20191219102115);
    expect(parsed).toBeInstanceOf(Date);
    // 10:21:15 EAT is 07:21:15 UTC — Kenya is UTC+3 with no DST.
    expect(parsed.toISOString()).toBe('2019-12-19T07:21:15.000Z');
  });

  it('parses the second documented sample', () => {
    expect(parseDarajaTimestamp('20170827163400').toISOString()).toBe('2017-08-27T13:34:00.000Z');
  });

  it('returns null for a malformed value', () => {
    expect(parseDarajaTimestamp('2019-12-19')).toBeNull();
    expect(parseDarajaTimestamp(123)).toBeNull();
    expect(parseDarajaTimestamp(null)).toBeNull();
  });

  it('is not fooled into 1970 by passing the raw number to Date', () => {
    const parsed = parseDarajaTimestamp(20191219102115);
    expect(parsed.getUTCFullYear()).toBe(2019);
  });
});

describe('ledger sign convention', () => {
  it('makes an invoice increase what is owed and a payment decrease it', () => {
    expect(signedAmount('invoice', 3000)).toBe(3000);
    expect(signedAmount('payment', 1500)).toBe(-1500);
    expect(LEDGER_SIGN.invoice).toBe(1);
    expect(LEDGER_SIGN.payment).toBe(-1);
  });

  it('refuses a pre-signed magnitude', () => {
    // The entry type decides the sign; passing a negative would double-negate.
    expect(() => signedAmount('payment', -1500)).toThrow(RangeError);
  });

  it('refuses a fractional magnitude', () => {
    expect(() => signedAmount('payment', 1500.5)).toThrow(RangeError);
  });

  it('refuses an unknown type', () => {
    expect(() => signedAmount('refund', 100)).toThrow(TypeError);
  });
});
