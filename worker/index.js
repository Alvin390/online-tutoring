import { toNodeRequest, createNodeResponse } from './nodeCompat.js';
import { resolveRoute, CRON_HANDLERS } from './routes.js';
import { runWithSubrequestBudget } from '../api/_lib/firestoreRest.js';
import { runInRequestContext } from '../api/_lib/requestContext.js';

/**
 * Cloudflare Worker entry point — Phase 12 D6.
 *
 * Replaces Vercel's filesystem routing and Vercel Cron. Two entry points:
 *
 *   fetch()      every /api/* request, via the route table in ./routes.js
 *   scheduled()  the three cron triggers declared in wrangler.jsonc
 *
 * Static assets are served by Cloudflare directly and never reach this code —
 * `run_worker_first: ["/api/*"]` in wrangler.jsonc is what draws that line, and
 * it is the direct parallel of the `"/((?!api/).*)"` rewrite that used to live
 * in vercel.json.
 */

/**
 * Subrequest budget armed on every invocation.
 *
 * Cloudflare's free plan allows 50 external subrequests per invocation and
 * kills anything that exceeds it. Arming slightly below that means a sweep
 * hits OUR limit first and stops cleanly with its cursor written, rather than
 * being terminated by the platform mid-write. Raise via SUBREQUEST_BUDGET on
 * Workers Paid, where the ceiling is 1,000.
 *
 * @see api/_lib/sweepCursor.js
 */
function budget() {
  const configured = Number(process.env.SUBREQUEST_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : 45;
}

/**
 * Security headers for API responses.
 *
 * These used to come from the `/(.*)` block in vercel.json, which covered
 * `/api/*` along with everything else. Cloudflare's `_headers` file does NOT
 * apply to Worker-generated responses — only to static assets — so without
 * this, every API response would lose HSTS, X-Frame-Options, Referrer-Policy,
 * COOP and CORP in the move.
 *
 * Applied here rather than inside createHandler because four handlers (the
 * three cron sweeps and the Daraja callback) deliberately bypass the
 * middleware chain, and a control that protects most responses is not a
 * control. `public/_headers` carries the same values for static assets.
 */
const API_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), '
    + 'magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()',
};

function applySecurityHeaders(response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    // `set` not `append`: a handler that set its own Referrer-Policy meant it.
    if (!headers.has(name)) headers.set(name, value);
  }

  // API responses are never cacheable. createHandler sets this already; the
  // handlers that bypass it do not all remember to.
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonError(status, code, message) {
  return applySecurityHeaders(
    new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  );
}

export default {
  // Each invocation runs in its OWN subrequest budget context (Phase 13 / 08
  // C9) — the counter used to be module-scoped and shared across requests.
  fetch(request, env, ctx) {
    return runWithSubrequestBudget(budget(), () =>
      runInRequestContext(contextFor(ctx, env), () => handleFetch(request, env, ctx)));
  },

  // One context around every sweep on a trigger: they share the invocation's
  // budget (Phase 13 / 06), and each checks what is left.
  scheduled(controller, env, ctx) {
    return runWithSubrequestBudget(budget(), () =>
      runInRequestContext(contextFor(ctx), () => handleScheduled(controller, env, ctx)));
  },
};

/**
 * What background work needs from the invocation (Phase 13 / 08 C3), and the
 * check-in pass limiter binding (002Fixes / 07) — bindings are not in
 * process.env, so code without `env` in hand finds it here.
 */
function contextFor(ctx, env) {
  return {
    waitUntil: typeof ctx?.waitUntil === 'function' ? (p) => ctx.waitUntil(p) : null,
    passLimiter: env?.CHECKIN_PASS_LIMITER ?? null,
  };
}

async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);

  // Belt and braces. With run_worker_first scoped to /api/*, a non-API
  // request should never arrive — but if the config is ever loosened, this
  // hands it back to the asset server rather than 404ing the whole site.
  if (!url.pathname.startsWith('/api/')) {
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return jsonError(404, 'not_found', 'Not found.');
  }

  const route = resolveRoute(url.pathname);
  if (!route) return jsonError(404, 'not_found', 'Not found.');

  try {
    const req = await toNodeRequest(request, route.params);

    // Phase 13 / 06 D5: background work (email, audit, heartbeats) must be
    // registered with the runtime, or Cloudflare may cancel it once the
    // response has been sent.
    if (!req.tooLarge && ctx && typeof ctx.waitUntil === 'function') {
      req.waitUntil = (promise) => ctx.waitUntil(promise);
    }

    if (req.tooLarge) {
      return jsonError(413, 'payload_too_large', 'Request body too large.');
    }

    const res = createNodeResponse();
    await route.handler(req, res);

    if (!res.writableEnded) {
      // A handler that returned without answering. Better a clean 500 than a
      // hung request.
      return jsonError(500, 'internal_error', 'Something went wrong. Please try again.');
    }

    return applySecurityHeaders(res.toResponse());
  } catch (err) {
    // The handlers own their error shapes; anything reaching here escaped
    // that. Log it in full server-side, return nothing revealing.
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Unhandled error in worker fetch',
      path: url.pathname,
      error: String(err?.stack ?? err),
    }));
    return jsonError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

/**
 * Cron triggers.
 *
 * The three sweeps keep their HTTP routes and their CRON_SECRET check, so a
 * teacher or an operator can still run one by hand and the Phase 11
 * monitoring is unchanged. Rather than duplicate each sweep's body, this
 * synthesises the request those handlers already expect — one code path,
 * exercised identically whether it fires from cron or from curl.
 *
 * `controller.cron` is the exact expression string from wrangler.jsonc, so
 * the mapping below must stay in step with the `triggers.crons` array.
 */
async function handleScheduled(controller, env, ctx) {
  const names = [CRON_SCHEDULE_TO_SWEEP[controller.cron] ?? []].flat();
  if (names.length === 0) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Cron fired with no matching sweep — check wrangler.jsonc triggers',
      cron: controller.cron,
    }));
    return;
  }

  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // The sweeps refuse to run without it, and silently doing nothing every
    // hour is exactly the failure nobody notices.
    console.error(JSON.stringify({
      level: 'error',
      msg: 'CRON_SECRET is not set — scheduled sweep cannot authorise itself',
      sweep: names.join(','),
    }));
    return;
  }

  // Sweeps sharing a trigger run in order, in ONE invocation, so they share
  // the subrequest budget armed above — each checks what is left.
  for (const name of names) {
    await runSweep(name, secret);
  }
}

/** Runs one sweep through its HTTP handler with a synthesised request. */
async function runSweep(name, secret) {
  const handler = CRON_HANDLERS[name];
  const req = {
    method: 'POST',
    url: `/api/cron/${name}`,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    query: {},
    body: Buffer.alloc(0),
    readable: false,
    socket: null,
  };

  const res = createNodeResponse();

  try {
    await handler(req, res);

    const payload = typeof res.body === 'string' ? res.body : '';
    console.log(JSON.stringify({
      level: res.statusCode >= 500 ? 'error' : 'info',
      msg: 'Scheduled sweep finished',
      sweep: name,
      status: res.statusCode,
      result: payload.slice(0, 500),
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'Scheduled sweep threw',
      sweep: name,
      error: String(err?.stack ?? err),
    }));
  }
}

/**
 * Cron expression -> sweep name.
 *
 * MUST match `triggers.crons` in wrangler.jsonc exactly, character for
 * character — Cloudflare passes the expression string back verbatim. A
 * mismatch logs loudly above rather than failing silently.
 */
const CRON_SCHEDULE_TO_SWEEP = {
  '0 * * * *': 'subscriptionSweep',   // hourly — subscription state and reminders
  '0 2 * * *': 'feesSweep',           // 02:00 UTC — overdue flags and invoice runs
  // every 10 min — recover lost M-Pesa callbacks, then retry report emails.
  // One trigger, two sweeps (money first): stays within the free plan's
  // cron-trigger allowance — Phase 13 / 06.
  '*/10 * * * *': ['mpesaReconcile', 'notificationsSweep'],
  // 003Fixes / 07: every minute — apply scheduled blocks that are due. One
  // query when nothing is due. The fourth of the free plan's five triggers.
  '* * * * *': 'scheduledBlocksSweep',
};

export { API_SECURITY_HEADERS, CRON_SCHEDULE_TO_SWEEP };
