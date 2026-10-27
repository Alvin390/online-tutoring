import logger from '@utils/logger';

/**
 * Serverless API client — Phase 01 D4.
 *
 * Same-origin fetch wrapper. Attaches the caller's Firebase ID token when one
 * exists, applies a timeout, and normalises errors into a single shape so
 * callers never have to distinguish "network died" from "server said no".
 *
 * Tokens are read from the Firebase SDK's own store on each call. They are
 * never copied into localStorage — a token in localStorage is readable by any
 * script that gets a foothold on the page, and it survives long after the
 * session that created it.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `path` (002Fixes / 01) names the endpoint without its query string, so a
 * report can say WHICH call failed; `retryAfter` is the server's Retry-After
 * in seconds, so a refused student can be told how long to wait.
 */
export class ApiError extends Error {
  constructor(message, { code, status, path, retryAfter } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code ?? 'unknown';
    this.status = status ?? 0;
    this.path = path ? String(path).split('?')[0] : undefined;
    this.retryAfter = retryAfter;
  }
}

/** Retry-After as whole seconds; the HTTP-date form is not sent by our API. */
function retryAfterSeconds(response) {
  const seconds = Number(response.headers?.get?.('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * Where ID tokens come from — Phase 13 / 08 A1.
 *
 * This module used to import the Firebase Auth instance directly, which put
 * the whole Firebase SDK (~130 KB gz) on every page that makes an API call —
 * including the student pages, which never sign in. Now the staff shell's
 * AuthProvider registers a token source when it mounts; public pages have
 * none and simply send no Authorization header.
 */
let tokenSource = null;

/** @param {(() => Promise<string|null>)|null} source */
export function setAuthTokenSource(source) {
  tokenSource = source;
}

async function authHeader() {
  if (!tokenSource) return {};
  try {
    const token = await tokenSource();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // An unrefreshable token is the same as no token; the endpoint will decide
    // whether that is acceptable.
    return {};
  }
}

const RETRY_DELAY_MS = 800;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One request, with our timeout and the caller's signal.
 *
 * 002Fixes / 04: an OK response whose body cannot be read is a NETWORK error,
 * not a null result — on 26 Oct a connection that dropped mid-body handed
 * `null` to check-in, which crashed destructuring it. A 204 is an empty object.
 */
async function send(method, path, body, { timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller-supplied signal as well as our own timeout.
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(path, {
      method,
      headers: method === 'GET'
        ? await authHeader()
        : { 'Content-Type': 'application/json', ...(await authHeader()) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
      signal: controller.signal,
      credentials: 'same-origin',
    });

    let payload = null;
    try {
      payload = response.status === 204 ? {} : await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new ApiError(
        payload?.error?.message ?? 'Request failed. Please try again.',
        { code: payload?.error?.code, status: response.status, path, retryAfter: retryAfterSeconds(response) }
      );
    }
    if (payload === null) throw new TypeError('Response body could not be read');

    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (err?.name === 'AbortError') {
      throw new ApiError('The request timed out. Please check your connection.', {
        code: 'timeout',
        path,
      });
    }

    logger.warn('API request failed', { path, name: err?.name });
    throw new ApiError('Unable to reach the server. Please check your connection.', {
      code: 'network_error',
      path,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `retry` (002Fixes / 04): how many more attempts after a timeout or a
 * network failure — never after an answer from the server, so never after a
 * 429. Opt-in, and only for reads that are safe to repeat (check-in, the
 * class link); a registration or a receipt is never sent twice.
 */
async function request(method, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, retry = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(method, path, body, { timeoutMs, signal });
    } catch (err) {
      const transient = err.code === 'timeout' || err.code === 'network_error';
      if (!transient || attempt >= retry || signal?.aborted) throw err;
      await wait(RETRY_DELAY_MS);
    }
  }
}

export const apiPost = (path, body, options) => request('POST', path, body, options);

export const apiGet = (path, options) => request('GET', path, undefined, options);
