import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The owner console's sign-in — 013Fixes / 38a (owner, 2026-11-26: an owner
 * password).
 *
 *   CONSOLE_PASSWORD        the owner's password (a Worker secret)
 *   CONSOLE_SESSION_SECRET  signs the session cookie (a Worker secret)
 *
 * The cookie is `__Host-console=<expiresMs>.<hex HMAC>`, HttpOnly, Secure,
 * SameSite=Strict, 12 hours. The HMAC also covers a hash of the password, so
 * changing the password signs every session out. Without either secret the
 * console stays shut (never open).
 */

export const COOKIE = '__Host-console';
export const SESSION_SECONDS = 12 * 60 * 60;

const sha256 = (v) => createHash('sha256').update(String(v ?? '')).digest();
const mac = (env, exp) => createHmac('sha256', env.CONSOLE_SESSION_SECRET)
  .update(`${exp}.${sha256(env.CONSOLE_PASSWORD).toString('hex')}`).digest('hex');

export const configured = (env) => Boolean(env?.CONSOLE_PASSWORD && env?.CONSOLE_SESSION_SECRET);

/** Constant-time (both sides hashed to the same length first). */
export function passwordMatches(env, given) {
  if (!configured(env) || typeof given !== 'string' || given.length === 0) return false;
  return timingSafeEqual(sha256(given), sha256(env.CONSOLE_PASSWORD));
}

export function issueCookie(env, now = Date.now()) {
  const exp = now + SESSION_SECONDS * 1000;
  return `${COOKIE}=${exp}.${mac(env, exp)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function cookieValue(request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return rest.join('=');
  }
  return null;
}

/** A valid, unexpired session for the current password. */
export function hasSession(request, env, now = Date.now()) {
  if (!configured(env)) return false;
  const value = cookieValue(request);
  if (!value) return false;
  const [expRaw, sig] = value.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now || exp > now + SESSION_SECONDS * 1000 + 60_000) return false;
  if (!/^[0-9a-f]{64}$/.test(sig ?? '')) return false;
  const expected = Buffer.from(mac(env, expRaw), 'hex');
  return timingSafeEqual(Buffer.from(sig, 'hex'), expected);
}
