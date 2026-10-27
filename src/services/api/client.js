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

export async function apiPost(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller-supplied signal as well as our own timeout.
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeader()),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      credentials: 'same-origin',
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new ApiError(
        payload?.error?.message ?? 'Request failed. Please try again.',
        { code: payload?.error?.code, status: response.status, path, retryAfter: retryAfterSeconds(response) }
      );
    }

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

export async function apiGet(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      method: 'GET',
      headers: await authHeader(),
      signal: controller.signal,
      credentials: 'same-origin',
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new ApiError(
        payload?.error?.message ?? 'Request failed. Please try again.',
        { code: payload?.error?.code, status: response.status, path, retryAfter: retryAfterSeconds(response) }
      );
    }

    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError('The request timed out. Please check your connection.', {
        code: 'timeout',
        path,
      });
    }
    throw new ApiError('Unable to reach the server. Please check your connection.', {
      code: 'network_error',
      path,
    });
  } finally {
    clearTimeout(timer);
  }
}
