// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Worker entry, routing and the Node adapter — Phase 12 D6/D7.
 *
 * Three classes of defect these guard against, all of which fail SILENTLY in
 * production rather than loudly in review:
 *
 *   1. A cron expression in wrangler.jsonc drifting from the dispatch table in
 *      worker/index.js. Cloudflare passes the expression back verbatim, so a
 *      one-character difference means the sweep simply never runs — no error,
 *      just a subscription state machine that quietly stops advancing.
 *   2. An endpoint missing from the route table. Vercel routed by filesystem
 *      convention; Cloudflare does not, so a handler that exists on disk but
 *      not in routes.js 404s.
 *   3. The raw request body being altered on its way to the Paystack HMAC.
 */

let routes;
let worker;
let nodeCompat;
let wranglerConfig;

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * wrangler.jsonc is JSON with comments, which JSON.parse rejects.
 *
 * A regex will not do this correctly, and getting it wrong here is not
 * harmless: the config legitimately contains the strings "/api/*" and
 * "*​/10 * * * *", so a naive `\/\*[\s\S]*?\*\/` treats the first as the start
 * of a block comment and deletes everything up to the second — silently
 * removing the cron schedules and the run_worker_first rule this file exists to
 * verify. Hence a character scanner that knows when it is inside a string.
 */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    out += char;
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

beforeAll(async () => {
  routes = await import('../../worker/routes.js');
  worker = await import('../../worker/index.js');
  nodeCompat = await import('../../worker/nodeCompat.js');
  wranglerConfig = parseJsonc(readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8'));
});

// ---------------------------------------------------------------------------
// Cron wiring
// ---------------------------------------------------------------------------

describe('cron wiring', () => {
  it('every schedule in wrangler.jsonc maps to a sweep', () => {
    // The drift this catches is invisible at runtime: Cloudflare fires the
    // trigger, the Worker finds no match, and the sweep never runs.
    for (const cron of wranglerConfig.triggers.crons) {
      expect(worker.CRON_SCHEDULE_TO_SWEEP[cron]).toBeDefined();
    }
  });

  it('every mapped sweep is actually scheduled', () => {
    // The reverse drift: a dispatch entry whose schedule was removed from the
    // config, so the sweep looks wired up but never fires.
    const scheduled = new Set(wranglerConfig.triggers.crons);
    for (const cron of Object.keys(worker.CRON_SCHEDULE_TO_SWEEP)) {
      expect(scheduled.has(cron)).toBe(true);
    }
  });

  it('every mapped sweep resolves to a real handler', () => {
    for (const name of Object.values(worker.CRON_SCHEDULE_TO_SWEEP)) {
      expect(typeof routes.CRON_HANDLERS[name]).toBe('function');
    }
  });

  it('keeps the intervals the Vercel Hobby plan could not provide', () => {
    // The reason for this migration. Hobby capped cron at once per day;
    // subscriptionSweep needs hourly and mpesaReconcile every ten minutes.
    const crons = wranglerConfig.triggers.crons;
    expect(crons).toContain('0 * * * *');
    expect(crons).toContain('*/10 * * * *');
  });

  it('each cron sweep is also reachable over HTTP for a manual run', () => {
    for (const name of Object.values(worker.CRON_SCHEDULE_TO_SWEEP)) {
      expect(routes.STATIC_ROUTES[`/api/cron/${name}`]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

describe('route table', () => {
  it('registers a handler for every endpoint file in api/', async () => {
    // Vercel derived routes from the filesystem. Nothing does that now, so a
    // new handler file that nobody adds here is simply unreachable.
    const { globSync } = await import('node:fs');
    const files = globSync('api/**/*.js', { cwd: ROOT })
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !f.startsWith('api/_lib/'));

    const missing = files.filter((file) => {
      const route = `/${file.replace(/\.js$/, '')}`;
      if (route.includes('[')) return false; // dynamic, checked separately
      return routes.STATIC_ROUTES[route] === undefined;
    });

    expect(missing).toEqual([]);
  });

  it('every registered route is a function', () => {
    for (const [path, handler] of Object.entries(routes.STATIC_ROUTES)) {
      expect(typeof handler, `${path} is not a handler`).toBe('function');
    }
  });

  it('resolves the Daraja callback and extracts its secret segment', () => {
    const resolved = routes.resolveRoute('/api/daraja/callback/abc123XYZ');
    expect(resolved).not.toBeNull();
    expect(resolved.params).toEqual({ secret: 'abc123XYZ' });
  });

  it('percent-decodes the callback secret', () => {
    expect(routes.resolveRoute('/api/daraja/callback/a%2Fb').params.secret).toBe('a/b');
  });

  it('does not match the callback route without a secret segment', () => {
    expect(routes.resolveRoute('/api/daraja/callback')).toBeNull();
    expect(routes.resolveRoute('/api/daraja/callback/')).toBeNull();
  });

  it('treats a trailing slash as the same endpoint', () => {
    expect(routes.resolveRoute('/api/health/')).not.toBeNull();
  });

  it('returns null for unknown paths', () => {
    expect(routes.resolveRoute('/api/nope')).toBeNull();
    expect(routes.resolveRoute('/dashboard')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Node request adapter
// ---------------------------------------------------------------------------

describe('toNodeRequest', () => {
  it('preserves the raw body byte for byte', async () => {
    // THE critical property. The Paystack webhook verifies an HMAC over the
    // exact bytes that were signed; re-serialising a parsed object changes key
    // order, whitespace and unicode escaping, and every legitimate webhook
    // would then fail verification.
    const body = '{"event":"charge.success","data":{"z":1,"a":2,"ref":"caf\\u00e9"}}';
    const request = new Request('https://example.com/api/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const req = await nodeCompat.toNodeRequest(request);

    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect(req.body.toString('utf8')).toBe(body);
  });

  it('lower-cases header names, as Node does', async () => {
    const request = new Request('https://example.com/api/health', {
      headers: { 'X-Paystack-Signature': 'abc', Authorization: 'Bearer t' },
    });

    const req = await nodeCompat.toNodeRequest(request);

    // Handlers index headers directly, e.g. req.headers['x-paystack-signature'].
    expect(req.headers['x-paystack-signature']).toBe('abc');
    expect(req.headers.authorization).toBe('Bearer t');
  });

  it('exposes query parameters', async () => {
    const request = new Request('https://example.com/api/calendar/export?token=abc&x=1');
    const req = await nodeCompat.toNodeRequest(request);

    expect(req.query).toEqual({ token: 'abc', x: '1' });
  });

  it('lets a path parameter win over a query string of the same name', async () => {
    // The Daraja callback authenticates on req.query.secret. If ?secret= could
    // override the path segment, an attacker would simply supply their own.
    const request = new Request('https://example.com/api/daraja/callback/real?secret=forged');
    const req = await nodeCompat.toNodeRequest(request, { secret: 'real' });

    expect(req.query.secret).toBe('real');
  });

  it('does not present a readable stream, since the body is already buffered', async () => {
    const request = new Request('https://example.com/api/x', { method: 'POST', body: '{}' });
    const req = await nodeCompat.toNodeRequest(request);

    // readRawBody() checks `req.readable` before trying to iterate the stream.
    // Claiming true here would make it hang on an already-consumed body.
    expect(req.readable).toBe(false);
  });

  it('flags an oversized body instead of buffering it', async () => {
    const request = new Request('https://example.com/api/x', {
      method: 'POST',
      body: 'x'.repeat(nodeCompat.MAX_BODY_BYTES + 1),
    });

    expect((await nodeCompat.toNodeRequest(request)).tooLarge).toBe(true);
  });

  it('leaves GET requests without a body', async () => {
    const req = await nodeCompat.toNodeRequest(new Request('https://example.com/api/health'));
    expect(req.body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Node response adapter
// ---------------------------------------------------------------------------

describe('NodeResponse', () => {
  it('converts status().json() into a Response', async () => {
    const res = nodeCompat.createNodeResponse();
    res.status(201).json({ ok: true });

    const response = res.toResponse();
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('replaces headers rather than accumulating them', async () => {
    // Node's setHeader replaces. Headers.append would produce
    // "no-store, no-store" on the handlers that set Cache-Control twice.
    const res = nodeCompat.createNodeResponse();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cache-Control', 'private');
    res.status(200).json({});

    expect(res.toResponse().headers.get('cache-control')).toBe('private');
  });

  it('tracks writableEnded', () => {
    const res = nodeCompat.createNodeResponse();
    expect(res.writableEnded).toBe(false);
    res.status(200).json({});
    expect(res.writableEnded).toBe(true);
  });

  it('sends a non-JSON body through send()', async () => {
    // api/calendar/export.js returns .ics text this way.
    const res = nodeCompat.createNodeResponse();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.status(200).send('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');

    const response = res.toResponse();
    expect(response.headers.get('content-type')).toContain('text/calendar');
    expect(await response.text()).toContain('BEGIN:VCALENDAR');
  });

  it('omits the body on 204, which a Response forbids', async () => {
    const res = nodeCompat.createNodeResponse();
    res.status(204).end();
    expect(res.toResponse().body).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('wrangler.jsonc', () => {
  it('enables nodejs_compat, which api/ needs for node:crypto', () => {
    expect(wranglerConfig.compatibility_flags).toContain('nodejs_compat');
  });

  it('has a compatibility_date late enough to populate process.env', () => {
    // nodejs_compat_populate_process_env is on by default from 2025-04-01.
    // Before that, every handler reading process.env would see undefined.
    expect(Date.parse(wranglerConfig.compatibility_date))
      .toBeGreaterThanOrEqual(Date.parse('2025-04-01'));
  });

  it('runs the Worker first for /api/*', () => {
    // Without this the SPA fallback answers every API call with index.html and
    // a 200, which surfaces as malformed JSON rather than an obvious failure.
    expect(wranglerConfig.assets.run_worker_first).toContain('/api/*');
  });

  it('serves the SPA fallback for client routes', () => {
    expect(wranglerConfig.assets.not_found_handling).toBe('single-page-application');
  });

  it('points at the built output and the worker entry', () => {
    expect(wranglerConfig.assets.directory).toBe('./dist/');
    expect(wranglerConfig.main).toBe('worker/index.js');
  });

  it('keeps observability on, or a CPU-limit failure is invisible', () => {
    expect(wranglerConfig.observability.enabled).toBe(true);
  });

  it('holds no secrets in vars', () => {
    // vars are plaintext in this committed file. Secrets belong in Cloudflare's
    // encrypted store via `npm run cf:secrets`.
    const suspicious = /secret|key|password|token|credential/i;
    for (const name of Object.keys(wranglerConfig.vars ?? {})) {
      expect(suspicious.test(name), `${name} looks like a secret`).toBe(false);
    }
  });
});

describe('API security headers', () => {
  it('carries the protections _headers cannot reach', () => {
    // public/_headers applies only to static assets, never to Worker
    // responses, so these have to be set in code or they are lost for /api/*.
    for (const header of [
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
    ]) {
      expect(worker.API_SECURITY_HEADERS[header]).toBeTruthy();
    }
  });

  it('allows popups, which the WhatsApp and Paystack flows depend on', () => {
    // same-origin (rather than same-origin-allow-popups) silently breaks
    // window.open to wa.me and the Paystack checkout.
    expect(worker.API_SECURITY_HEADERS['Cross-Origin-Opener-Policy'])
      .toBe('same-origin-allow-popups');
  });
});
