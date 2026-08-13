import { describe, it, expect, beforeEach } from 'vitest';
import {
  darajaTimestamp,
  buildPassword,
  toDarajaPhone,
  isSafaricomIp,
  parseCallbackMetadata,
  interpretResultCode,
  TRANSACTION_TYPE,
  MAX_ACCOUNT_REFERENCE,
  MAX_TRANSACTION_DESC,
  ENDPOINTS,
  _resetTokenCache,
} from '../../api/_lib/daraja.js';

/**
 * Daraja primitives — Phase 09.
 *
 * Every expectation below is checked against `upgrade/daraja_docs.txt`, because
 * Daraja's failure mode is a silent 500 or a transaction that simply never
 * arrives — not a helpful error message.
 */

beforeEach(() => {
  _resetTokenCache();
});

describe('endpoints', () => {
  it('matches the documented sandbox and production hosts', () => {
    // daraja_docs.txt:357-358
    expect(ENDPOINTS.sandbox.oauth).toContain('sandbox.safaricom.co.ke');
    expect(ENDPOINTS.production.oauth).toContain('api.safaricom.co.ke');
    expect(ENDPOINTS.sandbox.oauth).toContain('grant_type=client_credentials');
    // daraja_docs.txt:602
    expect(ENDPOINTS.sandbox.stkQuery).toContain('/mpesa/stkpushquery/v1/query');
  });
});

describe('transaction type', () => {
  it('maps till and paybill to the documented values', () => {
    // daraja_docs.txt:214. Getting this wrong does not error — the prompt
    // simply never arrives.
    expect(TRANSACTION_TYPE.till).toBe('CustomerBuyGoodsOnline');
    expect(TRANSACTION_TYPE.paybill).toBe('CustomerPayBillOnline');
  });
});

describe('darajaTimestamp', () => {
  it('produces YYYYMMDDHHmmss in East Africa Time', () => {
    // daraja_docs.txt:213. 06:24:08 UTC is 09:24:08 EAT.
    expect(darajaTimestamp(new Date('2021-06-28T06:24:08Z'))).toBe('20210628092408');
  });

  it('zero-pads every component', () => {
    expect(darajaTimestamp(new Date('2026-01-05T00:00:00Z'))).toBe('20260105030000');
  });

  it('is exactly 14 digits', () => {
    expect(darajaTimestamp(new Date())).toMatch(/^\d{14}$/);
  });
});

describe('buildPassword', () => {
  it('is base64(Shortcode + Passkey + Timestamp) with no separator', () => {
    // daraja_docs.txt:212. A separator produces a password Daraja rejects with
    // an unhelpful error.
    const password = buildPassword('174379', 'PASSKEY', '20210628092408');
    expect(Buffer.from(password, 'base64').toString('utf8'))
      .toBe('174379PASSKEY20210628092408');
  });

  it('reproduces the documented sample structure', () => {
    const password = buildPassword(174379, 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919', '20210628092408');
    const decoded = Buffer.from(password, 'base64').toString('utf8');
    expect(decoded.startsWith('174379')).toBe(true);
    expect(decoded.endsWith('20210628092408')).toBe(true);
  });
});

describe('toDarajaPhone', () => {
  it('produces 2547XXXXXXXX with no plus', () => {
    // daraja_docs.txt:216
    expect(toDarajaPhone('+254712345678')).toBe('254712345678');
    expect(toDarajaPhone('254712345678')).toBe('254712345678');
  });

  it('converts a local 07xx number', () => {
    expect(toDarajaPhone('0712345678')).toBe('254712345678');
  });

  it('adds the country code to a bare nine-digit number', () => {
    expect(toDarajaPhone('712345678')).toBe('254712345678');
  });

  it('strips separators', () => {
    expect(toDarajaPhone('+254 712 345 678')).toBe('254712345678');
  });

  it('returns null for empty input', () => {
    expect(toDarajaPhone('')).toBeNull();
    expect(toDarajaPhone(null)).toBeNull();
  });
});

describe('field length caps', () => {
  it('matches the documented maximums', () => {
    // daraja_docs.txt:220-221. Daraja does not reject over-long values
    // clearly; it fails opaquely.
    expect(MAX_ACCOUNT_REFERENCE).toBe(12);
    expect(MAX_TRANSACTION_DESC).toBe(13);
  });

  it('a Kenyan number without the plus fits AccountReference exactly', () => {
    expect('254712345678'.length).toBe(MAX_ACCOUNT_REFERENCE);
  });
});

describe('IP allowlist', () => {
  it('accepts documented Safaricom addresses', () => {
    expect(isSafaricomIp('196.201.214.200')).toBe(true);
    expect(isSafaricomIp('196.201.213.44')).toBe(true);
  });

  it('rejects everything else', () => {
    // Daraja callbacks are UNSIGNED, so this is the primary control rather
    // than a second layer.
    expect(isSafaricomIp('1.2.3.4')).toBe(false);
    expect(isSafaricomIp('196.201.214.201')).toBe(false);
    expect(isSafaricomIp('')).toBe(false);
    expect(isSafaricomIp(null)).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isSafaricomIp(' 196.201.214.200 ')).toBe(true);
  });
});

describe('parseCallbackMetadata', () => {
  it('flattens the documented successful callback', () => {
    // daraja_docs.txt:256-287
    const callback = {
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: 1.0 },
          { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
          { Name: 'TransactionDate', Value: 20191219102115 },
          { Name: 'PhoneNumber', Value: 254708374149 },
        ],
      },
    };

    expect(parseCallbackMetadata(callback)).toEqual({
      Amount: 1.0,
      MpesaReceiptNumber: 'NLJ7RT61SV',
      TransactionDate: 20191219102115,
      PhoneNumber: 254708374149,
    });
  });

  it('returns an empty object for a FAILED callback, which has no metadata', () => {
    // daraja_docs.txt:300-301 — CallbackMetadata is present only on success.
    const failed = {
      MerchantRequestID: 'f1e2-4b95',
      CheckoutRequestID: 'ws_CO_21072024125243250722943992',
      ResultCode: 1032,
      ResultDesc: 'Request cancelled by user',
    };
    expect(parseCallbackMetadata(failed)).toEqual({});
  });

  it('handles malformed metadata without throwing', () => {
    expect(parseCallbackMetadata({ CallbackMetadata: { Item: 'not an array' } })).toEqual({});
    expect(parseCallbackMetadata({ CallbackMetadata: {} })).toEqual({});
    expect(parseCallbackMetadata(null)).toEqual({});
  });

  it('skips items with no Name', () => {
    const result = parseCallbackMetadata({
      CallbackMetadata: { Item: [{ Value: 1 }, { Name: 'Amount', Value: 5 }] },
    });
    expect(result).toEqual({ Amount: 5 });
  });
});

describe('interpretResultCode', () => {
  it('treats 0 as success', () => {
    // daraja_docs.txt:295
    expect(interpretResultCode(0).status).toBe('success');
  });

  it('treats 1032 as CANCELLED, not failed', () => {
    // "Request cancelled by user" (daraja_docs.txt:296). A parent changing
    // their mind is a normal outcome; recording it as an error makes the
    // teacher's dashboard look broken.
    const result = interpretResultCode(1032);
    expect(result.status).toBe('cancelled');
    expect(result.userFacing).toContain('cancelled');
  });

  it('distinguishes timeout, insufficient funds and wrong PIN', () => {
    expect(interpretResultCode(1037).status).toBe('timeout');
    expect(interpretResultCode(1).status).toBe('insufficient_funds');
    expect(interpretResultCode(2001).status).toBe('wrong_pin');
  });

  it('falls back to a generic failure for an unknown code', () => {
    expect(interpretResultCode(9999).status).toBe('failed');
  });

  it('accepts a string result code', () => {
    expect(interpretResultCode('0').status).toBe('success');
    expect(interpretResultCode('1032').status).toBe('cancelled');
  });

  it('always returns user-facing wording that never blames the student', () => {
    for (const code of [0, 1, 1032, 1037, 2001, 9999]) {
      const result = interpretResultCode(code);
      expect(result.userFacing, String(code)).toBeTruthy();
      expect(result.userFacing).not.toMatch(/error|failed|invalid/i);
    }
  });
});
