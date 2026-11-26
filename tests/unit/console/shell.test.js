// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../../console/worker.js';

/**
 * 013Fixes / 38a — the owner console's shell: the owner password (owner,
 * 2026-11-26), the session cookie, and the registry of schools (in the
 * console's own KV; no secrets in it, https addresses only). Read-only towards
 * the schools: changes are made in each school's own superadmin.
 */

const BASE = 'https://console.example';
const PASSWORD = 'correct horse battery staple';

function fakeKv() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => { const v = m.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

let env;
beforeEach(() => {
  env = {
    CONSOLE_PASSWORD: PASSWORD,
    CONSOLE_SESSION_SECRET: 'session-secret-for-tests',
    CONSOLE_SECRET: 'shared-console-secret',
    CONSOLE_KV: fakeKv(),
    LOGIN_LIMITER: { limit: async () => ({ success: true }) },
  };
});

const req = (path, { method = 'GET', body, cookie, headers = {} } = {}) => new Request(`${BASE}${path}`, {
  method,
  headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const go = (path, opts) => worker.fetch(req(path, opts), env, { waitUntil: () => {} });
async function signIn(password = PASSWORD) {
  const res = await go('/login', { method: 'POST', body: { password } });
  const set = res.headers.get('set-cookie') ?? '';
  return { res, set, cookie: set.split(';')[0] };
}

describe('the owner password', () => {
  it('signed out: the page asks for the password and shows no school; the data needs a session', async () => {
    const page = await go('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const html = await page.text();
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/Owner console/);
    expect((await go('/api/schools')).status).toBe(401);
    expect((await go('/api/registry')).status).toBe(401);
  });

  it('wrong password: 401 and no cookie; right password: a strict session cookie (12 h)', async () => {
    const bad = await signIn('nope');
    expect(bad.res.status).toBe(401);
    expect(bad.set).toBe('');
    const ok = await signIn();
    expect(ok.res.status).toBe(200);
    expect(ok.set).toMatch(/^__Host-console=/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) expect(ok.set).toContain(part);
    expect(ok.set).not.toContain(PASSWORD);
    expect((await go('/api/registry', { cookie: ok.cookie })).status).toBe(200);
  });

  it('a tampered or expired cookie: 401', async () => {
    const { cookie } = await signIn();
    const [name, value] = cookie.split('=');
    const [exp, sig] = value.split('.');
    expect((await go('/api/registry', { cookie: `${name}=${exp}.${sig.slice(0, -2)}aa` })).status).toBe(401);
    expect((await go('/api/registry', { cookie: `${name}=${Number(exp) + 1}.${sig}` })).status).toBe(401);
    expect((await go('/api/registry', { cookie: `${name}=${Date.now() - 1000}.${sig}` })).status).toBe(401);
  });

  it('changing the password signs every session out', async () => {
    const { cookie } = await signIn();
    env.CONSOLE_PASSWORD = 'a new password entirely';
    expect((await go('/api/registry', { cookie })).status).toBe(401);
  });

  it('too many tries: 429 (the sign-in limiter)', async () => {
    env.LOGIN_LIMITER = { limit: async () => ({ success: false }) };
    expect((await signIn()).res.status).toBe(429);
  });

  it('not set up (no password or session secret): sign-in refused, never open', async () => {
    delete env.CONSOLE_PASSWORD;
    expect((await signIn()).res.status).toBe(503);
    env.CONSOLE_PASSWORD = PASSWORD;
    delete env.CONSOLE_SESSION_SECRET;
    expect((await signIn()).res.status).toBe(503);
  });

  it('sign out clears the cookie', async () => {
    const { cookie } = await signIn();
    const res = await go('/logout', { method: 'POST', body: {}, cookie });
    expect(res.headers.get('set-cookie')).toMatch(/__Host-console=;.*Max-Age=0/);
  });

  it('changes are JSON POSTs only', async () => {
    const { cookie } = await signIn();
    const form = await worker.fetch(new Request(`${BASE}/api/registry`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=add' }), env, {});
    expect(form.status).toBe(415);
  });
});

describe('the registry of schools', () => {
  let cookie;
  beforeEach(async () => { ({ cookie } = await signIn()); });
  const registry = (body) => go('/api/registry', { method: 'POST', body, cookie });

  it('add, list, remove; stored in the console\'s KV without any secret', async () => {
    let res = await registry({ action: 'add', name: 'Pilot School', url: 'https://online-tutoring.example.workers.dev' });
    expect(res.status, await res.clone().text()).toBe(200);
    res = await registry({ action: 'add', name: 'Second School', url: 'https://second.example.com/', secretRef: 'CONSOLE_SECRET_SECOND' });
    expect(res.status).toBe(200);
    const list = await (await go('/api/registry', { cookie })).json();
    expect(list.schools.map((s) => [s.name, s.url, s.secretRef ?? null])).toEqual([
      ['Pilot School', 'https://online-tutoring.example.workers.dev', null],
      ['Second School', 'https://second.example.com', 'CONSOLE_SECRET_SECOND'],
    ]);
    const stored = [...env.CONSOLE_KV.m.values()].join(' ');
    expect(stored).not.toContain('shared-console-secret');
    res = await registry({ action: 'remove', id: list.schools[1].id });
    expect(res.status).toBe(200);
    expect((await (await go('/api/registry', { cookie })).json()).schools).toHaveLength(1);
  });

  it('https addresses only, no path, no credentials; no duplicates', async () => {
    for (const url of ['http://school.example', 'school.example', 'https://user:pw@school.example', 'https://school.example/api/x', 'https://127.0.0.1', 'https://localhost', 'javascript:alert(1)']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await registry({ action: 'add', name: 'Bad', url });
      expect(res.status, url).toBe(400);
    }
    await registry({ action: 'add', name: 'A', url: 'https://a.example' });
    expect((await registry({ action: 'add', name: 'A again', url: 'https://a.example/' })).status).toBe(409);
  });

  it('a secret reference is only the NAME of a console secret', async () => {
    expect((await registry({ action: 'add', name: 'X', url: 'https://x.example', secretRef: 'sk_live_abc123' })).status).toBe(400);
    expect((await registry({ action: 'add', name: 'X', url: 'https://x.example', secretRef: 'CONSOLE_SECRET_X' })).status).toBe(200);
  });
});
