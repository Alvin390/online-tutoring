// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { digestFor, runDigest } from '../../../console/lib/digest.js';
import { rowFor } from '../../../console/lib/table.js';
import worker from '../../../console/worker.js';

/**
 * 013Fixes / 38c — the daily digest email to the owner: schools ending soon
 * (7 days or less), locked or expired, over a usage limit, low on SMS units,
 * or that can't be reached. Sent only when something needs a look, and only
 * to the address set in the console. The recipient is a console setting.
 */

const NOW = Date.parse('2026-11-26T04:00:00Z');
const D = 86_400_000;
const school = (id, name) => ({ id, name, url: `https://${id}.example` });
const st = (over = {}) => ({
  plan: { tier: 'gold', status: 'active', comp: false, endsAt: NOW + 30 * D },
  lastPayment: null,
  usage: { activeStudents: 10, sessions: 1, logins: 1, limits: { activeStudents: 500, sessions: 5, logins: 10 }, percent: { activeStudents: 2, sessions: 20, logins: 10 } },
  sms: { available: 2000, includedLeft: 2000, topup: 0, granted: 3000 },
  modes: { payments: 'live', sms: 'real', maintenance: { on: false, until: null }, demo: false },
  mpesa: { mode: 'off' },
  version: null,
  ...over,
});
const row = (s, status) => rowFor(s, status ? { reachable: true, status } : { reachable: false, error: 'no answer within 5 s' }, NOW);

describe('the digest\'s content', () => {
  it('nothing to report: no email', () => {
    expect(digestFor([row(school('a', 'Fine School'), st())])).toBeNull();
  });

  it('each school that needs a look, and why', () => {
    const rows = [
      row(school('a', 'Fine School'), st()),
      row(school('b', 'Ending School'), st({ plan: { tier: 'silver', status: 'active', comp: false, endsAt: NOW + 3 * D } })),
      row(school('c', 'Locked School'), st({ plan: { tier: 'gold', status: 'locked', comp: false, endsAt: NOW - D } })),
      row(school('d', 'Busy School'), st({ usage: { activeStudents: 520, sessions: 1, logins: 1, limits: { activeStudents: 500, sessions: 5, logins: 10 }, percent: { activeStudents: 104, sessions: 20, logins: 10 } } })),
      row(school('e', 'Quiet School'), st({ sms: { available: 50, includedLeft: 50, topup: 0, granted: 3000 } })),
      row(school('f', 'Gone School'), null),
    ];
    const d = digestFor(rows);
    expect(d.subject).toBe('Owner console: 5 schools need a look');
    expect(d.text).toMatch(/Ending School: ends in 3 days/);
    expect(d.text).toMatch(/Locked School: Locked/);
    expect(d.text).toMatch(/Busy School: over a usage limit \(520\/500 learners/);
    expect(d.text).toMatch(/Quiet School: low on SMS \(50 units left\)/);
    expect(d.text).toMatch(/Gone School: can't reach it \(no answer within 5 s\)/);
    expect(d.text).not.toMatch(/Fine School/);
    expect(d.text).toMatch(/https:\/\/b\.example\/superadmin/);
  });
});

describe('sending it', () => {
  const kv = (data) => {
    const m = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
    return { m, get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => m.set(k, v) };
  };
  const ending = { ...st(), plan: { tier: 'gold', status: 'active', comp: false, endsAt: NOW + 2 * D } };
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

  it('to the console\'s digest address only, when something needs a look', async () => {
    const send = vi.fn(async () => ({}));
    const env = { CONSOLE_SECRET: 's', CONSOLE_KV: kv({ registry: [school('b', 'Ending School')], settings: { digestTo: 'owner@school.example' } }) };
    const r = await runDigest(env, { send, fetchImpl: async () => ok(ending), now: NOW });
    expect(r).toMatchObject({ sent: true, schools: 1 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@school.example', subject: 'Owner console: 1 school needs a look' }));
  });

  it('no address set, or nothing to report: nothing sent', async () => {
    const send = vi.fn();
    const noAddress = { CONSOLE_SECRET: 's', CONSOLE_KV: kv({ registry: [school('b', 'Ending School')] }) };
    expect(await runDigest(noAddress, { send, fetchImpl: async () => ok(ending), now: NOW })).toMatchObject({ sent: false, reason: 'no_recipient' });
    const fine = { CONSOLE_SECRET: 's', CONSOLE_KV: kv({ registry: [school('a', 'Fine School')], settings: { digestTo: 'owner@school.example' } }) };
    expect(await runDigest(fine, { send, fetchImpl: async () => ok(st()), now: NOW })).toMatchObject({ sent: false, reason: 'nothing_to_report' });
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed send is logged, never thrown (the cron keeps running)', async () => {
    const env = { CONSOLE_SECRET: 's', CONSOLE_KV: kv({ registry: [school('b', 'Ending School')], settings: { digestTo: 'owner@school.example' } }) };
    const r = await runDigest(env, { send: async () => { throw new Error('gmail down'); }, fetchImpl: async () => ok(ending), now: NOW });
    expect(r).toMatchObject({ sent: false, reason: 'send_failed' });
  });
});

describe('the digest address (a console setting)', () => {
  it('signed in: read and set; a bad address is refused; empty switches it off', async () => {
    const m = new Map();
    const env = {
      CONSOLE_PASSWORD: 'pw', CONSOLE_SESSION_SECRET: 's',
      CONSOLE_KV: { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => m.set(k, v) },
    };
    const go = (path, init = {}) => worker.fetch(new Request(`https://console.example${path}`, init), env, {});
    expect((await go('/api/settings')).status).toBe(401);
    const login = await go('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const set = (digestTo) => go('/api/settings', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ digestTo }) });
    expect(await (await go('/api/settings', { headers: { cookie } })).json()).toEqual({ digestTo: null });
    expect((await set('not-an-address')).status).toBe(400);
    expect((await set('owner@school.example')).status).toBe(200);
    expect(await (await go('/api/settings', { headers: { cookie } })).json()).toEqual({ digestTo: 'owner@school.example' });
    expect((await set('')).status).toBe(200);
    expect(await (await go('/api/settings', { headers: { cookie } })).json()).toEqual({ digestTo: null });
  });
});
