import { getDb } from './firebaseAdmin.js';
import { decrypt } from './crypto.js';
import { ApiError } from './errors.js';
import { darajaMode, darajaEnvironment, darajaVar } from './mode.js';

/**
 * M-Pesa Daraja client — Phase 09.
 *
 * Every constant and field name below is taken from `upgrade/daraja_docs.txt`,
 * with line references, because Daraja's failure mode is a silent 500 or a
 * transaction that vanishes — not a helpful error.
 *
 * MONEY GOES 100% TO THE TEACHER'S TILL (Q38). There is no split payment, no
 * settlement account and no reconciliation between two parties. The platform
 * initiates and records; it never holds funds. That is why there is no
 * marketplace/split-payment code here at all.
 */

const ENDPOINTS = {
  sandbox: {
    // daraja_docs.txt:357
    oauth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    // daraja_docs.txt:602
    stkQuery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
  },
  production: {
    // daraja_docs.txt:358
    oauth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    stkQuery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
  },
};

/**
 * Transaction type by shortcode kind — daraja_docs.txt:214.
 * Getting this wrong does not error; the prompt simply never arrives.
 */
export const TRANSACTION_TYPE = {
  till: 'CustomerBuyGoodsOnline',
  paybill: 'CustomerPayBillOnline',
};

/**
 * Field length caps — daraja_docs.txt:220-221. Daraja does not reject an
 * over-long value with a clear message; it truncates or fails opaquely.
 */
export const MAX_ACCOUNT_REFERENCE = 12;
export const MAX_TRANSACTION_DESC = 13;

/**
 * Safaricom callback source IPs.
 *
 * DARAJA CALLBACKS ARE UNSIGNED — there is no HMAC, no shared secret and no
 * signature header anywhere in the specification. So unlike the Paystack
 * webhook in Phase 03, the IP allowlist is the PRIMARY control here rather than
 * a second layer, and it is backed by an unguessable path segment plus an
 * amount cross-check against the initiating record.
 *
 * Safaricom publishes these but has changed them historically, so the list is
 * overridable by env var without a redeploy.
 */
export const SAFARICOM_IPS = (process.env.DARAJA_CALLBACK_IPS
  ?? [
    '196.201.214.200',
    '196.201.214.206',
    '196.201.213.114',
    '196.201.214.207',
    '196.201.214.208',
    '196.201.213.44',
    '196.201.212.127',
    '196.201.212.138',
    '196.201.212.129',
    '196.201.212.136',
    '196.201.212.74',
    '196.201.212.69',
  ].join(',')
)
  .split(',')
  .map((ip) => ip.trim())
  .filter(Boolean);

export function isSafaricomIp(ip) {
  return SAFARICOM_IPS.includes(String(ip ?? '').trim());
}

/** `YYYYMMDDHHmmss` in East Africa Time — daraja_docs.txt:213. */
export function darajaTimestamp(date = new Date()) {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${eat.getUTCFullYear()}${pad(eat.getUTCMonth() + 1)}${pad(eat.getUTCDate())}`
    + `${pad(eat.getUTCHours())}${pad(eat.getUTCMinutes())}${pad(eat.getUTCSeconds())}`
  );
}

/**
 * `base64(Shortcode + Passkey + Timestamp)` — daraja_docs.txt:212.
 *
 * Concatenation with no separator. A separator produces a password Daraja
 * rejects with an unhelpful error.
 */
export function buildPassword(shortCode, passkey, timestamp) {
  return Buffer.from(`${shortCode}${passkey}${timestamp}`, 'utf8').toString('base64');
}

/** `2547XXXXXXXX` — no plus, no leading zero (daraja_docs.txt:216). */
export function toDarajaPhone(phone) {
  const digits = String(phone ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Loads and decrypts the teacher's Daraja credentials.
 *
 * These move real money out of a real till, so they are AES-256-GCM encrypted
 * at rest (Phase 01 D5) and `integrations/daraja` is `allow read, write: if
 * false` for every client including the superadmin. Only the Admin SDK reads it.
 */
/**
 * Credentials from the environment, when the current mode has a full set.
 *
 * A local-testing convenience so STK pushes can be exercised without going
 * through the credentials form first. Returns null unless EVERY field for the
 * active mode is present — a partial set would fail against Safaricom with a
 * confusing error rather than falling through to the stored record.
 */
function credentialsFromEnv() {
  const consumerKey = darajaVar('DARAJA_CONSUMER_KEY');
  const consumerSecret = darajaVar('DARAJA_CONSUMER_SECRET');
  const passkey = darajaVar('DARAJA_PASSKEY');
  const shortCode = darajaVar('DARAJA_SHORTCODE');

  if (!consumerKey || !consumerSecret || !passkey || !shortCode) return null;

  return {
    shortCode: String(shortCode),
    shortCodeType: darajaVar('DARAJA_SHORTCODE_TYPE') === 'paybill' ? 'paybill' : 'till',
    environment: darajaEnvironment(),
    consumerKey,
    consumerSecret,
    passkey,
    // Env-supplied credentials are taken as operator-verified: whoever set them
    // has the .env file, and there is no form step that could have tested them.
    verifiedAt: new Date(),
    source: 'env',
  };
}

export async function loadCredentials() {
  // Environment first, so DARAJA_MODE genuinely controls which till is hit.
  const fromEnv = credentialsFromEnv();
  if (fromEnv) return fromEnv;

  const snap = await getDb().doc('integrations/daraja').get();

  if (!snap.exists) {
    throw new ApiError(
      503,
      'daraja_not_configured',
      'M-Pesa payments are not set up yet.',
      {
        expose: true,
        cause: new Error(
          `No DARAJA_${darajaMode() === 'live' ? 'LIVE' : 'SANDBOX'}_* env credentials and no integrations/daraja record`
        ),
      }
    );
  }

  const data = snap.data();

  try {
    return {
      shortCode: String(data.shortCode ?? ''),
      shortCodeType: data.shortCodeType === 'paybill' ? 'paybill' : 'till',
      // DARAJA_MODE wins over the stored value when it is explicitly set, so
      // flipping the env var moves the whole app between sandbox and
      // production without editing the Firestore record.
      environment: process.env.DARAJA_MODE
        ? darajaEnvironment()
        : (data.environment === 'production' ? 'production' : 'sandbox'),
      consumerKey: decrypt(data.consumerKeyEnc),
      consumerSecret: decrypt(data.consumerSecretEnc),
      passkey: decrypt(data.passkeyEnc),
      verifiedAt: data.verifiedAt ?? null,
      source: 'firestore',
    };
  } catch (err) {
    // A decryption failure means the encryption key changed or the record is
    // corrupt. Either way this is not something to retry against.
    throw new ApiError(
      503,
      'daraja_credentials_unreadable',
      'M-Pesa credentials could not be read. Please re-enter them.',
      { expose: true, cause: err }
    );
  }
}

// ---------------------------------------------------------------------------
// OAuth — daraja_docs.txt:69-99
// ---------------------------------------------------------------------------

/**
 * Token cache, module-scoped so it survives across warm invocations.
 *
 * Daraja reports `expires_in: 3599` (daraja_docs.txt:93) — note 3599, not the
 * 3600 the plan assumed. Refreshing at 3300 seconds gives a five-minute margin
 * against clock skew either way, so the discrepancy does not matter, but it is
 * worth having read rather than assumed.
 *
 * SINGLE-FLIGHT: concurrent callers during a refresh await one in-flight fetch
 * rather than stampeding Safaricom with duplicate token requests.
 */
const REFRESH_AFTER_MS = 3300 * 1000;

let cachedToken = null;
let cachedAt = 0;
let cacheKey = null;
let inFlight = null;

export async function getAccessToken(credentials) {
  const key = `${credentials.environment}:${credentials.consumerKey.slice(0, 8)}`;
  const now = Date.now();

  if (cachedToken && cacheKey === key && now - cachedAt < REFRESH_AFTER_MS) {
    return cachedToken;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const basic = Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
      'utf8'
    ).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(ENDPOINTS[credentials.environment].oauth, {
        method: 'GET',
        headers: { Authorization: `Basic ${basic}` },
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.access_token) {
        throw new ApiError(
          502,
          'daraja_auth_failed',
          'Could not authenticate with M-Pesa. Check the consumer key and secret.',
          { cause: new Error(`Daraja OAuth ${response.status}: ${JSON.stringify(payload)}`) }
        );
      }

      cachedToken = payload.access_token;
      cachedAt = Date.now();
      cacheKey = key;
      return cachedToken;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err?.name === 'AbortError') {
        throw new ApiError(504, 'daraja_timeout', 'M-Pesa did not respond. Please try again.');
      }
      throw new ApiError(502, 'daraja_unreachable', 'Could not reach M-Pesa.', { cause: err });
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test-only: clears the module-scope cache. */
export function _resetTokenCache() {
  cachedToken = null;
  cachedAt = 0;
  cacheKey = null;
  inFlight = null;
}

// ---------------------------------------------------------------------------
// STK Push — daraja_docs.txt:193-241
// ---------------------------------------------------------------------------

async function darajaPost(url, token, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ApiError(
        response.status >= 500 ? 502 : 400,
        'daraja_error',
        payload?.errorMessage ?? payload?.ResponseDescription ?? 'M-Pesa rejected that request.',
        { cause: new Error(`Daraja ${url}: ${JSON.stringify(payload)}`) }
      );
    }

    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError(504, 'daraja_timeout', 'M-Pesa did not respond. Please try again.');
    }
    throw new ApiError(502, 'daraja_unreachable', 'Could not reach M-Pesa.', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Initiates an STK push.
 *
 * @returns Daraja's response — `MerchantRequestID`, `CheckoutRequestID`,
 *          `ResponseCode` ("0" means accepted, daraja_docs.txt:239).
 */
export async function initiateStkPush({ credentials, amount, payerPhone, accountReference, description, callbackUrl }) {
  const token = await getAccessToken(credentials);
  const timestamp = darajaTimestamp();
  const phone = toDarajaPhone(payerPhone);

  if (!phone) throw new ApiError(400, 'invalid_phone', 'That phone number is not valid for M-Pesa.');

  const body = {
    BusinessShortCode: Number(credentials.shortCode),
    Password: buildPassword(credentials.shortCode, credentials.passkey, timestamp),
    Timestamp: timestamp,
    TransactionType: TRANSACTION_TYPE[credentials.shortCodeType],
    // Daraja takes whole shillings here; the ledger is integer KES throughout,
    // so no conversion is needed in this direction.
    Amount: amount,
    PartyA: phone,
    PartyB: Number(credentials.shortCode),
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    // Truncated to the documented caps rather than sent long — Daraja does not
    // reject an over-long value clearly, it fails opaquely.
    AccountReference: String(accountReference).slice(0, MAX_ACCOUNT_REFERENCE),
    TransactionDesc: String(description ?? 'Fees').slice(0, MAX_TRANSACTION_DESC),
  };

  return darajaPost(ENDPOINTS[credentials.environment].stkPush, token, body);
}

/** Status query — daraja_docs.txt:600-674. Used by the reconciliation nets. */
export async function queryStkStatus({ credentials, checkoutRequestId }) {
  const token = await getAccessToken(credentials);
  const timestamp = darajaTimestamp();

  return darajaPost(ENDPOINTS[credentials.environment].stkQuery, token, {
    BusinessShortCode: Number(credentials.shortCode),
    Password: buildPassword(credentials.shortCode, credentials.passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  });
}

// ---------------------------------------------------------------------------
// Callback parsing — daraja_docs.txt:256-306
// ---------------------------------------------------------------------------

/**
 * Flattens `CallbackMetadata.Item[]` into an object.
 *
 * Daraja sends `[{ Name: 'Amount', Value: 1.0 }, …]` rather than a plain
 * object, and the array is present ONLY for successful transactions
 * (daraja_docs.txt:300-301).
 */
export function parseCallbackMetadata(callback) {
  const items = callback?.CallbackMetadata?.Item;
  if (!Array.isArray(items)) return {};

  const out = {};
  for (const item of items) {
    if (item && typeof item.Name === 'string') out[item.Name] = item.Value;
  }
  return out;
}

/**
 * Interprets a `ResultCode`.
 *
 * 0 is success; everything else is a failure with a reason
 * (daraja_docs.txt:295). 1032 specifically is the user cancelling the prompt,
 * which is a normal outcome rather than an error — recording it as "failed"
 * would make a teacher's dashboard look broken when a parent simply changed
 * their mind.
 */
export function interpretResultCode(resultCode) {
  const code = Number(resultCode);

  if (code === 0) return { status: 'success', userFacing: 'Payment received.' };
  if (code === 1032) {
    return { status: 'cancelled', userFacing: 'You cancelled the payment request.' };
  }
  if (code === 1037) {
    return { status: 'timeout', userFacing: 'The request timed out. Please try again.' };
  }
  if (code === 1) {
    return { status: 'insufficient_funds', userFacing: 'There was not enough money in the M-Pesa account.' };
  }
  if (code === 2001) {
    return { status: 'wrong_pin', userFacing: 'The M-Pesa PIN was incorrect.' };
  }

  return { status: 'failed', userFacing: 'The payment did not go through. Please try again.' };
}

export { ENDPOINTS };
