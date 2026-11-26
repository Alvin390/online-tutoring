import { randomBytes } from 'node:crypto';
import { pageHtml } from './page.js';
import { configured, passwordMatches, issueCookie, clearCookie, hasSession } from './lib/session.js';
import { readRegistry, addSchool, removeSchool, RegistryError } from './lib/registry.js';
import { schoolsTable } from './lib/table.js';

/**
 * The owner console — 013Fixes / 38 (owner suggestion 9). A separate Worker
 * (console/wrangler.jsonc), read-only towards the schools: it lists each
 * school's status from its signed status link (phase 37); changes are made
 * in each school's own superadmin.
 *
 *   GET  /               the page (sign-in form until signed in; no data in it)
 *   POST /login          { password } → the session cookie (owner password)
 *   POST /logout
 *   GET  /api/registry   the schools listed          (session)
 *   POST /api/registry   { action: add|remove, … }   (session, JSON)
 *   GET  /api/schools    one row per school, checked now  (session; 38b)
 *   +38c /api/settings and the daily digest
 */

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'cross-origin-opener-policy': 'same-origin',
};

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY, ...headers },
});
export const fail = (status, code, message) => json(status, { error: { code, message } });

function page() {
  const nonce = randomBytes(16).toString('base64');
  return new Response(pageHtml(nonce), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...SECURITY,
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}

async function readJson(request) {
  if (!String(request.headers.get('content-type') ?? '').includes('application/json')) return { error: fail(415, 'json_only', 'Send JSON.') };
  try { return { body: await request.json() }; } catch { return { error: fail(400, 'bad_json', 'That was not valid JSON.') }; }
}

async function login(request, env) {
  if (!configured(env)) return fail(503, 'not_set_up', 'The console is not set up yet.');
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (typeof env.LOGIN_LIMITER?.limit === 'function') {
    const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip}` }).catch(() => ({ success: true }));
    if (success === false) return fail(429, 'too_many_tries', 'Too many tries. Wait a minute.');
  }
  const { body, error } = await readJson(request);
  if (error) return error;
  if (!passwordMatches(env, body?.password)) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'Console sign-in refused' }));
    return fail(401, 'wrong_password', 'Wrong password.');
  }
  return json(200, { ok: true }, { 'set-cookie': issueCookie(env) });
}

async function registry(request, env) {
  if (request.method === 'GET') return json(200, { schools: await readRegistry(env.CONSOLE_KV) });
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Not allowed.');
  const { body, error } = await readJson(request);
  if (error) return error;
  try {
    if (body?.action === 'add') return json(200, { schools: await addSchool(env.CONSOLE_KV, body) });
    if (body?.action === 'remove') return json(200, { schools: await removeSchool(env.CONSOLE_KV, String(body.id ?? '')) });
    return fail(400, 'bad_action', 'Unknown action.');
  } catch (err) {
    if (err instanceof RegistryError) return fail(err.status, err.code, err.message);
    throw err;
  }
}

/** 38b: every school's row, checked now (in parallel, 5 s each). */
async function schools(request, env) {
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Not allowed.');
  const checkedAt = Date.now();
  const rows = await schoolsTable(await readRegistry(env.CONSOLE_KV), env, { now: checkedAt });
  return json(200, { rows, checkedAt });
}

/** Routes for the signed-in console; later phases add theirs here. */
export const API_ROUTES = { '/api/registry': registry, '/api/schools': schools };

export async function handle(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname === '/' && request.method === 'GET') return page();
  if (pathname === '/login' && request.method === 'POST') return login(request, env);
  if (pathname === '/logout' && request.method === 'POST') return json(200, { ok: true }, { 'set-cookie': clearCookie() });
  if (pathname.startsWith('/api/')) {
    if (!hasSession(request, env)) return fail(401, 'signed_out', 'Sign in first.');
    const route = API_ROUTES[pathname];
    if (!route) return fail(404, 'not_found', 'Not found.');
    if (request.method === 'POST' && !String(request.headers.get('content-type') ?? '').includes('application/json')) {
      return fail(415, 'json_only', 'Send JSON.');
    }
    return route(request, env, ctx);
  }
  return fail(404, 'not_found', 'Not found.');
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'Console error', error: String(err?.message ?? err) }));
      return fail(500, 'internal_error', 'Something went wrong.');
    }
  },
};
