import { countExternalSubrequest } from './firestoreRest.js';
/**
 * Gmail API sender — Phase 13 / 06 D4.
 *
 * WHY GMAIL. No domain, and the recipient must be editable from superadmin.
 * Resend without a verified domain only delivers to its own account owner, and
 * Cloudflare's email service needs a domain on Cloudflare. Sending through a
 * real Gmail account via Google's API gives Google-signed mail (SPF, DKIM and
 * DMARC pass for gmail.com) to ANY recipient, free. Setup:
 * docs/GMAIL_SETUP.md.
 *
 * Secrets (Worker secrets, never in the repo):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER
 *
 * The access token is cached per isolate until five minutes before expiry —
 * one token exchange an hour, not one per email.
 *
 * Errors are classified, because the retry sweep treats them differently:
 *   invalid_grant  the refresh token is dead (revoked, password changed, app
 *                  left in Testing, or 6 months unused). Not retryable — a
 *                  human must reconnect. Surfaced on the superadmin card.
 *   429 / 5xx      retryable with backoff.
 *   other 4xx      permanent for this message.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = 'GmailError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function gmailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID
    && process.env.GMAIL_CLIENT_SECRET
    && process.env.GMAIL_REFRESH_TOKEN
    && process.env.GMAIL_SENDER
  );
}

let cachedToken = { value: null, expiresAt: 0 };

export function __resetGmailTokenCache() {
  cachedToken = { value: null, expiresAt: 0 };
}

/**
 * @param {{force?: boolean}} [options] force = bypass the cache (the weekly
 *        keep-alive uses it so an unused token is exercised and stays alive).
 */
export async function getGmailAccessToken({ force = false } = {}) {
  if (!gmailConfigured()) {
    throw new GmailError('not_configured', 'Email is not set up: the GMAIL_* secrets are missing.');
  }
  if (!force && cachedToken.value && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  let response;
  try {
    countExternalSubrequest();
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }).toString(),
    });
  } catch (err) {
    throw new GmailError('network', `Could not reach Google: ${err?.message ?? err}`, { retryable: true });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      throw new GmailError('invalid_grant', 'Gmail is disconnected (the refresh token was revoked or expired). Reconnect it.', { status: response.status });
    }
    throw new GmailError(
      body.error ?? 'token_error',
      `Google token exchange failed (${response.status}${body.error ? `: ${body.error}` : ''}).`,
      { retryable: response.status >= 500 || response.status === 429, status: response.status }
    );
  }

  const ttlMs = Number(body.expires_in ?? 3600) * 1000;
  cachedToken = { value: body.access_token, expiresAt: Date.now() + ttlMs - 5 * 60_000 };
  return body.access_token;
}

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

function assertAddress(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) {
    throw new GmailError('bad_address', `Invalid ${label} address.`);
  }
  return value;
}

/** Header-safe value: CR/LF stripped (no header injection), RFC 2047 if non-ASCII. */
export function encodeHeaderValue(value) {
  const clean = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** Base64 wrapped at 76 characters, as RFC 2045 requires for a body part. */
function base64Body(text) {
  return (Buffer.from(String(text ?? ''), 'utf8').toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n');
}

/**
 * An RFC 5322 message: multipart/alternative with a plain-text and an HTML
 * part (both base64, UTF-8). Plain text matters for deliverability as much as
 * for accessibility — HTML-only mail scores worse with spam filters.
 */
export function buildMimeMessage({ from, fromName = 'Online Tutoring Alerts', to, replyTo, subject, text, html }) {
  assertAddress(from, 'sender');
  assertAddress(to, 'recipient');
  if (replyTo) assertAddress(replyTo, 'reply-to');

  const boundary = `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${encodeHeaderValue(fromName)} <${from}>`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function toBase64Url(value) {
  return Buffer.from(String(value), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sends one message through the configured Gmail account.
 * @returns {Promise<{id: string}>}
 */
export async function sendGmail({ to, replyTo, subject, text, html }) {
  const token = await getGmailAccessToken();
  const raw = toBase64Url(buildMimeMessage({
    from: process.env.GMAIL_SENDER,
    to,
    replyTo,
    subject,
    text,
    html,
  }));

  let response;
  try {
    countExternalSubrequest();
    response = await fetch(SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
  } catch (err) {
    throw new GmailError('network', `Could not reach Gmail: ${err?.message ?? err}`, { retryable: true });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) __resetGmailTokenCache();
    throw new GmailError(
      `http_${response.status}`,
      body?.error?.message ?? `Gmail refused the message (${response.status}).`,
      { retryable: response.status >= 500 || response.status === 429 || response.status === 401, status: response.status }
    );
  }
  return { id: body.id };
}
