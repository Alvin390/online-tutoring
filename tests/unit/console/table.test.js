// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { fetchSchoolStatus } from '../../../console/lib/fetchStatus.js';
import { rowFor, schoolsTable } from '../../../console/lib/table.js';
import { verifyConsoleRequest } from '../../../api/_lib/consoleSignature.js';
import worker from '../../../console/worker.js';

/**
 * 013Fixes / 38b — the console's table: one signed request per school (the
 * same signing as the school's status link, phase 37), in parallel, 5 s each;
 * a school that can't be reached shows "can't reach" and never fails the
 * page; each reply becomes one row of plain text.
 */

const SECRET = 'shared-console-secret';
const NOW = Date.parse('2026-11-26T09:00:00Z');
const D = 86_400_000;
const PILOT = { id: 'p1', name: 'Pilot School', url: 'https://pilot.example.workers.dev' };

const status = (over = {}) => ({
  school: { name: 'Focus Academy' },
  plan: { tier: 'gold', status: 'active', comp: false, renewalMode: 'manual', endsAt: NOW + 5 * D, trialEndsAt: null, currentPeriodEnd: NOW + 5 * D, cancelAtPeriodEnd: false },
  lastPayment: { at: Date.parse('2026-11-01T09:00:00Z'), amountKes: 14999, method: 'mpesa', tier: 'gold' },
  usage: { activeStudents: 460, sessions: 2, logins: 3, limits: { activeStudents: 500, sessions: 5, logins: 10 }, percent: { activeStudents: 92, sessions: 40, logins: 30 }, countedAt: NOW - 3_600_000 },
  sms: { available: 120, includedLeft: 120, topup: 0, granted: 3000 },
  modes: { payments: 'test', sms: 'real', maintenance: { on: false, until: null }, demo: false },
  mpesa: { mode: 'off' },
  version: { id: '6ab181bc-9a74-4d6c-bbca-662a56dbc57c', tag: null, timestamp: '2026-11-26T06:47:00Z' },
  checkedAt: NOW,
  ...over,
});
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('fetching a school\'s status', () => {
  it('signs exactly as the school checks it (method, host, path, timestamp)', async () => {
    const fetchImpl = vi.fn(async () => ok(status()));
    const r = await fetchSchoolStatus(PILOT, { CONSOLE_SECRET: SECRET }, { fetchImpl, now: NOW });
    expect(r.reachable).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://pilot.example.workers.dev/api/platform/status');
    const h = init.headers;
    expect(verifyConsoleRequest(SECRET, {
      method: 'GET', host: 'pilot.example.workers.dev', path: '/api/platform/status',
      timestamp: h['x-console-timestamp'], signature: h['x-console-signature'], now: NOW,
    })).toEqual({ ok: true });
  });

  it('a named secret, or a Service Binding, when the registry says so', async () => {
    const binding = { fetch: vi.fn(async () => ok(status())) };
    const fetchImpl = vi.fn();
    const r = await fetchSchoolStatus({ ...PILOT, secretRef: 'CONSOLE_SECRET_PILOT', binding: 'PILOT_SCHOOL' },
      { CONSOLE_SECRET_PILOT: 'pilot-secret', PILOT_SCHOOL: binding }, { fetchImpl, now: NOW });
    expect(r.reachable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    const sent = binding.fetch.mock.calls[0][0];
    expect(verifyConsoleRequest('pilot-secret', {
      method: 'GET', host: 'pilot.example.workers.dev', path: '/api/platform/status',
      timestamp: sent.headers.get('x-console-timestamp'), signature: sent.headers.get('x-console-signature'), now: NOW,
    })).toEqual({ ok: true });
  });

  it('can\'t reach: refused, switched off, an error, no secret, or no answer in 5 s', async () => {
    const cases = [
      [async () => new Response('{}', { status: 401 }), /signature refused/],
      [async () => new Response('{}', { status: 404 }), /status link is off/],
      [async () => new Response('x', { status: 502 }), /HTTP 502/],
      [async () => { throw new Error('getaddrinfo ENOTFOUND'); }, /no answer/],
    ];
    for (const [impl, msg] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetchSchoolStatus(PILOT, { CONSOLE_SECRET: SECRET }, { fetchImpl: impl, now: NOW });
      expect(r.reachable).toBe(false);
      expect(r.error).toMatch(msg);
    }
    expect(await fetchSchoolStatus(PILOT, {}, { fetchImpl: vi.fn(), now: NOW })).toMatchObject({ reachable: false, error: expect.stringMatching(/no secret/) });
    const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const t0 = Date.now();
    const slow = await fetchSchoolStatus(PILOT, { CONSOLE_SECRET: SECRET }, { fetchImpl: hang, now: NOW, timeoutMs: 50 });
    expect(slow).toMatchObject({ reachable: false, error: expect.stringMatching(/no answer within/) });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('the rows', () => {
  it('a reply becomes plain-text cells, with warnings where they matter', () => {
    const row = rowFor(PILOT, { reachable: true, status: status() }, NOW);
    expect(row).toMatchObject({
      name: 'Pilot School', reachable: true, superadminUrl: 'https://pilot.example.workers.dev/superadmin',
      plan: 'Gold', status: 'Active', daysLeft: '5 days', daysClass: 'warn',
      lastPayment: 'KES 14,999 on 1 Nov 2026 (M-Pesa)',
      usage: '460/500 learners · 2/5 sessions · 3/10 logins', usageClass: 'warn',
      sms: '120 units left', smsClass: 'warn',
      modes: 'Payments: test', modesClass: 'warn',
      version: '6ab181bc',
    });
  });

  it('gift, locked, maintenance, demo, ended, no payment', () => {
    const row = rowFor(PILOT, { reachable: true, status: status({
      plan: { tier: 'silver', status: 'locked', comp: true, endsAt: NOW - 2 * D },
      lastPayment: null,
      modes: { payments: 'live', sms: 'fake', maintenance: { on: true, until: null }, demo: true },
      mpesa: { mode: 'demo' },
      sms: { available: 0, includedLeft: 0, topup: 0, granted: 1000 },
    }) }, NOW);
    expect(row).toMatchObject({
      plan: 'Silver (gift)', status: 'Locked', statusClass: 'bad', daysLeft: 'Ended', daysClass: 'bad',
      lastPayment: 'None yet', sms: '0 units left', smsClass: 'bad',
      modes: 'MAINTENANCE · DEMO · SMS: fake · Pay now: demo', modesClass: 'bad',
    });
  });

  it('a school that can\'t be reached is a row too', () => {
    expect(rowFor(PILOT, { reachable: false, error: 'no answer within 5 s' }, NOW)).toEqual({
      id: 'p1', name: 'Pilot School', url: PILOT.url, superadminUrl: `${PILOT.url}/superadmin`, reachable: false, error: 'no answer within 5 s',
    });
  });

  it('every school at once, in parallel; one failing doesn\'t stop the others', async () => {
    let inFlight = 0; let most = 0;
    const fetchImpl = async (url) => {
      inFlight += 1; most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      if (url.includes('down.example')) throw new Error('down');
      return ok(status());
    };
    const schools = [PILOT, { id: 'd', name: 'Down School', url: 'https://down.example' }, { id: 'x', name: 'Third', url: 'https://third.example' }];
    const rows = await schoolsTable(schools, { CONSOLE_SECRET: SECRET }, { fetchImpl, now: NOW });
    expect(rows.map((r) => [r.name, r.reachable])).toEqual([['Pilot School', true], ['Down School', false], ['Third', true]]);
    expect(most).toBe(3);
  });
});

describe('GET /api/schools (signed in)', () => {
  it('the rows and when they were checked; 401 signed out', async () => {
    const kv = new Map([['registry', JSON.stringify([PILOT])]]);
    const env = {
      CONSOLE_PASSWORD: 'pw', CONSOLE_SESSION_SECRET: 's', CONSOLE_SECRET: SECRET,
      CONSOLE_KV: { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, v) },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ok(status());
    try {
      expect((await worker.fetch(new Request('https://console.example/api/schools'), env, {})).status).toBe(401);
      const login = await worker.fetch(new Request('https://console.example/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) }), env, {});
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const res = await worker.fetch(new Request('https://console.example/api/schools', { headers: { cookie } }), env, {});
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({ name: 'Pilot School', reachable: true, plan: 'Gold' });
      expect(typeof body.checkedAt).toBe('number');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// 013Fixes / 39 (found on the live console): a gift has no end date — the
// school's billing window is null for it — so an old currentPeriodEnd from
// before the gift must not show "Ended", nor put the school in the digest.
describe('a gift that never ends', () => {
  it('shows "No end (gift)", not "Ended" from a stale period end', () => {
    const row = rowFor(PILOT, { reachable: true, status: status({
      plan: { tier: 'gold', status: 'active', comp: true, endsAt: null, trialEndsAt: null, currentPeriodEnd: NOW - 40 * D },
    }) }, NOW);
    expect(row).toMatchObject({ plan: 'Gold (gift)', status: 'Active', daysLeft: 'No end (gift)', daysClass: '' });
  });

  it('a paid plan with no window yet: a dash, not a stale date', () => {
    const row = rowFor(PILOT, { reachable: true, status: status({
      plan: { tier: 'silver', status: 'active', comp: false, endsAt: null, currentPeriodEnd: NOW - 40 * D },
    }) }, NOW);
    expect(row).toMatchObject({ daysLeft: '—', daysClass: '' });
  });
});
