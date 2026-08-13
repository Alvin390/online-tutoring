import { randomUUID } from 'node:crypto';
import { createLogger } from './log.js';
import { sendError, badRequest, methodNotAllowed, payloadTooLarge } from './errors.js';
import { authenticate, requireRole, requireTier } from './auth.js';
import { enforceRateLimit, clientIp } from './rateLimit.js';
import { validate } from './validate.js';

/**
 * The middleware chain — Phase 01 D4.
 *
 * Every handler runs through this, in this order:
 *
 *   method check → content-type check → body size cap → rate limit
 *     → auth → role/tier → schema validation → handler
 *
 * The order is not arbitrary. Cheap rejections come first so an attacker
 * cannot make us do expensive work (a token verification, a Firestore read)
 * before we have decided to refuse them. Rate limiting sits ahead of auth for
 * the same reason: verifying a token costs a network round trip, and an
 * unauthenticated flood must not be able to buy those.
 *
 * A handler that does not use createHandler does not merge.
 */

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Reads the raw request body.
 *
 * Vercel's Node runtime pre-parses JSON bodies onto `req.body`, but the
 * Paystack webhook needs the exact bytes that were signed — re-serialising a
 * parsed object does not reliably reproduce them (key order, whitespace,
 * unicode escapes). This reads the stream when it is still available and falls
 * back to whatever the runtime already gave us.
 */
export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  if (req.readable) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw payloadTooLarge();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // Already consumed and parsed by the runtime; best effort.
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.alloc(0);
}

function parseJsonBody(req, raw) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (!raw || raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}

/**
 * @param {object} opts
 * @param {string|string[]} opts.method        allowed HTTP method(s)
 * @param {boolean} [opts.auth]                require a verified ID token
 * @param {string}  [opts.role]                minimum role
 * @param {string}  [opts.tier]                minimum subscription tier
 * @param {object}  [opts.schema]              Zod schema for the body
 * @param {object}  [opts.rateLimit]           { bucket, limit, windowSeconds, keyBy }
 * @param {boolean} [opts.rawBody]             pass raw bytes instead of parsed JSON
 * @param {Function} opts.handle               (ctx) => Promise<any>
 */
export function createHandler(opts) {
  const {
    method = 'POST',
    auth = false,
    role = null,
    tier = null,
    schema = null,
    rateLimit = null,
    rawBody = false,
    handle,
  } = opts;

  const allowedMethods = Array.isArray(method) ? method : [method];

  return async function vercelHandler(req, res) {
    const requestId = randomUUID();
    const log = createLogger(requestId);
    res.setHeader('X-Request-Id', requestId);

    // These endpoints are same-origin only. No CORS headers are emitted at all,
    // which is stricter than emitting a restrictive one — a browser will refuse
    // a cross-origin read outright.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    try {
      // 1. Method
      if (!allowedMethods.includes(req.method)) {
        res.setHeader('Allow', allowedMethods.join(', '));
        throw methodNotAllowed(`${req.method} is not supported on this endpoint.`);
      }

      // 2. Content type — only for methods that carry a body
      const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
      if (hasBody && !rawBody) {
        const contentType = String(req.headers['content-type'] || '');
        if (!contentType.includes('application/json')) {
          throw badRequest('Content-Type must be application/json.', 'unsupported_media_type');
        }
      }

      // 3. Body size cap, from the declared length. The streaming read in
      //    readRawBody enforces the same cap on the actual bytes, so a lying
      //    Content-Length buys nothing.
      const declaredLength = Number(req.headers['content-length'] ?? 0);
      if (declaredLength > MAX_BODY_BYTES) throw payloadTooLarge();

      const raw = hasBody ? await readRawBody(req) : Buffer.alloc(0);
      if (raw.length > MAX_BODY_BYTES) throw payloadTooLarge();

      const ip = clientIp(req);

      // 4. Rate limit — before auth, so token verification cannot be used as
      //    an amplification lever.
      if (rateLimit) {
        const key = rateLimit.keyBy === 'ip'
          ? ip
          : (rateLimit.resolveKey?.({ req, ip }) ?? ip);

        await enforceRateLimit({
          key,
          bucket: rateLimit.bucket,
          limit: rateLimit.limit,
          windowSeconds: rateLimit.windowSeconds,
        });
      }

      // 5. Auth
      let user = null;
      if (auth) {
        user = await authenticate(req);
        if (role) requireRole(user, role);
        if (tier) requireTier(user, tier);
      }

      // 6. Validation — strict schemas, so an unexpected key is a rejection.
      let body = {};
      if (hasBody && !rawBody) {
        body = parseJsonBody(req, raw);
        if (schema) body = validate(schema, body);
      } else if (schema && req.method === 'GET') {
        body = validate(schema, req.query ?? {});
      }

      // 7. Handle
      const result = await handle({ req, res, body, raw, user, log, ip, requestId });

      if (!res.writableEnded) {
        res.status(200).json(result ?? { ok: true });
      }
    } catch (err) {
      if (!res.writableEnded) sendError(res, err, log);
    }
  };
}

export { MAX_BODY_BYTES };
