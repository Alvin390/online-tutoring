import { toNodeRequest, createNodeResponse } from './nodeCompat.js';
import { resolveRoute, CRON_HANDLERS } from './routes.js';
import { armSubrequestBudget } from '../api/_lib/firestoreRest.js';

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
  async fetch(request, env, ctx) {
    armSubrequestBudget(budget());

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
  },

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
  async scheduled(controller, env, ctx) {
    armSubrequestBudget(budget());

    const name = CRON_SCHEDULE_TO_SWEEP[controller.cron];
    if (!name) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'Cron fired with no matching sweep — check wrangler.jsonc triggers',
        cron: controller.cron,
      }));
      return;
    }

    const handler = CRON_HANDLERS[name];
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      // The sweeps refuse to run without it, and silently doing nothing every
      // hour is exactly the failure nobody notices.
      console.error(JSON.stringify({
        level: 'error',
        msg: 'CRON_SECRET is not set — scheduled sweep cannot authorise itself',
        sweep: name,
      }));
      return;
    }

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
  },
};

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
  '*/10 * * * *': 'mpesaReconcile',   // every 10 min — recover lost M-Pesa callbacks
};

export { API_SECURITY_HEADERS, CRON_SCHEDULE_TO_SWEEP };
