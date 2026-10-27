import { randomUUID } from 'node:crypto';
import { createLogger } from './log.js';
import { sendError, badRequest, methodNotAllowed, payloadTooLarge } from './errors.js';
import { authenticate, requireRole, requireTier } from './auth.js';
import { enforceRateLimit, clientIp } from './rateLimit.js';
import { validate } from './validate.js';
import { subrequestsSpent } from './firestoreRest.js';
import { getDb } from './firebaseAdmin.js';
import { assertSessionExists } from './sessions.js';
import { PASS_HEADER } from './checkinPass.js';

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
 * Server-Timing instrumentation — Phase 13 / 01 D3.
 *
 * Off unless PERF_TIMING=1, which is set for local measurement only. When on,
 * every response carries `Server-Timing: total;dur=…, auth;dur=…, subreq;desc=N`
 * so scripts/perf/apiLatency.mjs can attribute latency without a profiler.
 * `subreq` is the number of Firestore REST calls the request made (the same
 * counter the subrequest budget uses).
 */
function perfTimingEnabled() {
  return process.env.PERF_TIMING === '1';
}

/**
 * Phase 13 / 08 D2: `total` is sent on EVERY response, in production too, so
 * real-user tooling (Sentry, DevTools) can tell server time from network
 * time. Nothing internal is exposed by it. The breakdown (`auth`, `subreq`)
 * stays behind PERF_TIMING.
 */
function writeServerTiming(res, perf) {
  if (!perf || res.headersSent) return;
  const total = performance.now() - perf.start;
  const parts = [`total;dur=${total.toFixed(1)}`];
  if (perf.detailed) {
    if (perf.auth != null) parts.push(`auth;dur=${perf.auth.toFixed(1)}`);
    parts.push(`subreq;desc="${subrequestsSpent() - perf.subreqStart}"`);
  }
  res.setHeader('Server-Timing', parts.join(', '));
}

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
 * Runs `promise` after the response without blocking it — Phase 13 / 06 D5.
 *
 * On Cloudflare the promise is handed to `ctx.waitUntil`, so the runtime keeps
 * the invocation alive until it settles. A bare un-awaited promise (what the
 * class-link audit, the check-in heartbeat and the feed stamp used to be) can
 * be cancelled the moment the response is sent. Outside a Worker (Node tests,
 * scripts) the promise simply runs. Failures are logged, never thrown.
 *
 * @returns {Promise<void>} settles when the task does (tests may await it)
 */
export function backgroundTask(req, promise, log) {
  const guarded = Promise.resolve()
    .then(() => promise)
    .then(() => undefined, (err) => log?.error?.('Background task failed', err));
  if (typeof req?.waitUntil === 'function') req.waitUntil(guarded);
  return guarded;
}

/**
 * @param {object} opts
 * @param {string|string[]} opts.method        allowed HTTP method(s)
 * @param {boolean} [opts.auth]                require a verified ID token
 * @param {string}  [opts.role]                minimum role
 * @param {string}  [opts.tier]                minimum subscription tier
 * @param {object}  [opts.schema]              Zod schema for the body
 * @param {object}  [opts.rateLimit]           { bucket, limit, windowSeconds, keyBy, bypass? }
 *   bypass({ req, body }) → Promise<boolean> (002Fixes / 07): checked after
 *   validation for a request carrying a check-in pass; true skips the limit
 *   and sets req.passAccepted for the handler.
 * @param {boolean} [opts.rawBody]             pass raw bytes instead of parsed JSON
 * @param {'active'|'any'} [opts.sessions]     Phase 13 / 02 D6: after validation,
 *        every session slug in the body (`session`, `sessions[]`, `sessionIds[]`)
 *        must exist — 'active' additionally requires it to be shown to students.
 *        Unknown → 404. Exposed as `handler.sessionPolicy` for the policy test.
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
    sessions = null,
    handle,
  } = opts;

  const allowedMethods = Array.isArray(method) ? method : [method];

  async function checkSessions(body) {
    const slugs = new Set();
    if (typeof body?.session === 'string') slugs.add(body.session);
    for (const key of ['sessions', 'sessionIds']) {
      if (Array.isArray(body?.[key])) body[key].forEach((s) => slugs.add(s));
    }
    if (slugs.size === 0) return;
    const db = getDb();
    await Promise.all(
      [...slugs].map((slug) => assertSessionExists(db, slug, { requireActive: sessions === 'active' }))
    );
  }

  async function vercelHandler(req, res) {
    const requestId = randomUUID();
    const log = createLogger(requestId);
    const detailed = perfTimingEnabled();
    const perf = { start: performance.now(), subreqStart: subrequestsSpent(), auth: null, detailed };
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
      const limitRequest = () => enforceRateLimit({
        key: rateLimit.keyBy === 'ip' ? ip : (rateLimit.resolveKey?.({ req, ip }) ?? ip),
        bucket: rateLimit.bucket,
        limit: rateLimit.limit,
        windowSeconds: rateLimit.windowSeconds,
      });
      // 002Fixes / 07: a request carrying a check-in pass is limited AFTER
      // validation (6a), so the pass can be checked against the body. Every
      // other request is limited here, exactly as before.
      const deferLimit = Boolean(rateLimit?.bypass && req.headers[PASS_HEADER]);
      if (rateLimit && !deferLimit) await limitRequest();

      // 5. Auth
      let user = null;
      if (auth) {
        const authStart = perf.detailed ? performance.now() : 0;
        user = await authenticate(req);
        if (perf.detailed) perf.auth = performance.now() - authStart;
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

      // 6a. The deferred limit (002Fixes / 07): a valid pass for this body
      //     skips it, and the handler is told so; anything else is limited
      //     exactly as a request without a pass.
      if (deferLimit) {
        if (await rateLimit.bypass({ req, body })) req.passAccepted = true;
        else await limitRequest();
      }

      // 6b. Session existence (Phase 13 / 02 D6) — after validation, so the
      //     slugs are already well-formed and not reserved.
      if (sessions) await checkSessions(body);

      // 7. Handle
      const waitUntil = (promise) => backgroundTask(req, promise, log);
      const result = await handle({ req, res, body, raw, user, log, ip, requestId, waitUntil });

      if (!res.writableEnded) {
        writeServerTiming(res, perf);
        res.status(200).json(result ?? { ok: true });
      }
    } catch (err) {
      if (!res.writableEnded) {
        writeServerTiming(res, perf);
        sendError(res, err, log);
      }
    }
  }

  vercelHandler.sessionPolicy = sessions;
  return vercelHandler;
}

export { MAX_BODY_BYTES };
