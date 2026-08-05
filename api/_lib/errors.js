/**
 * Safe error shapes — Phase 01 D4.
 *
 * The contract: a client receives a stable machine-readable `code`, a short
 * human message written for an end user, and nothing else. No stack traces, no
 * Firebase internals, no upstream vendor payloads. Everything useful for
 * debugging goes to the server log, which the client never sees.
 */

export class ApiError extends Error {
  constructor(status, code, message, { expose = true, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.cause = cause;
  }
}

export const badRequest = (msg = 'Invalid request.', code = 'bad_request') =>
  new ApiError(400, code, msg);

export const unauthorized = (msg = 'Authentication required.', code = 'unauthorized') =>
  new ApiError(401, code, msg);

export const forbidden = (msg = 'You do not have access to this resource.', code = 'forbidden') =>
  new ApiError(403, code, msg);

export const notFound = (msg = 'Not found.', code = 'not_found') =>
  new ApiError(404, code, msg);

export const methodNotAllowed = (msg = 'Method not allowed.') =>
  new ApiError(405, 'method_not_allowed', msg);

export const payloadTooLarge = (msg = 'Request body too large.') =>
  new ApiError(413, 'payload_too_large', msg);

export const tooManyRequests = (msg = 'Too many requests. Please try again later.', retryAfter) => {
  const err = new ApiError(429, 'rate_limited', msg);
  err.retryAfter = retryAfter;
  return err;
};

export const serverError = (cause) =>
  new ApiError(500, 'internal_error', 'Something went wrong. Please try again.', {
    expose: false,
    cause,
  });

/**
 * Terminal error handler. Anything that is not an ApiError is treated as
 * unexpected and collapsed to a generic 500 — an unrecognised error is exactly
 * the case where we cannot vouch for what its message contains.
 */
export function sendError(res, err, log) {
  const apiError = err instanceof ApiError ? err : serverError(err);

  if (apiError.status >= 500) {
    log?.error('Unhandled error in API handler', apiError.cause ?? apiError);
  } else {
    log?.warn(`Request rejected: ${apiError.code}`, { status: apiError.status });
  }

  if (apiError.retryAfter) {
    res.setHeader('Retry-After', String(apiError.retryAfter));
  }

  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.expose ? apiError.message : 'Something went wrong. Please try again.',
    },
  });
}
