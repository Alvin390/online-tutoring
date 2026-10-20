#!/usr/bin/env node
/**
 * API latency harness — Phase 13 / 01 D3.
 *
 *   npm run perf:latency -- --base http://127.0.0.1:8787 --runs 50
 *   npm run perf:latency -- --base https://online-tutoring.alvinkariuki07.workers.dev --live
 *
 * Reports p50 / p75 / p95 / p99 / max per endpoint, sequential and concurrent,
 * plus the server's own Server-Timing breakdown when PERF_TIMING=1 is set on the
 * target (local wrangler dev).
 *
 * --live restricts the run to READ-ONLY endpoints that write nothing, caps the
 * rate at 1 request/second and the run at 200 requests. No logins, no writes,
 * no load testing against production.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, [])
);

const BASE = String(args.base ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const LIVE = Boolean(args.live);
const RUNS = Math.min(Number(args.runs ?? (LIVE ? 20 : 50)), LIVE ? 40 : 1000);
const CONCURRENCY = LIVE ? 1 : Number(args.concurrency ?? 10);
const OUT = args.out ?? null;
const LIVE_CAP = 200;

/** Endpoints safe to hit anywhere: no writes, no auth. */
const READ_ONLY = [
  { name: 'health', method: 'GET', path: '/api/health' },
];

/** Local-only endpoints (they may write, e.g. a check-in heartbeat). */
/**
 * Local-only endpoints (they may write, e.g. a check-in heartbeat). Bodies are
 * functions so each call can use a different seeded student: the per-phone and
 * per-IP rate limits would otherwise turn half the samples into 429s and
 * measure the limiter instead of the endpoint. Indices are seedLocal.mjs
 * students in the `morning` session (index % 3 === 0) that are neither blocked
 * (index % 25) nor pending (index % 10).
 */
const seededMorningPhone = (n) => {
  let i = 3 * (n % 160) + 3;
  while (i % 25 === 0 || i % 10 === 0) i += 3;
  return `+2547${String(10000000 + i).padStart(8, '0')}`;
};
const LOCAL = [
  { name: 'checkin', method: 'POST', path: '/api/student/checkin', body: (n) => ({ session: 'morning', phone: seededMorningPhone(n) }) },
  { name: 'classLink', method: 'POST', path: '/api/class/link', body: (n) => ({ session: 'morning', phone: seededMorningPhone(n) }) },
];

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const r = (n) => (n == null ? null : Math.round(n * 10) / 10);
  return {
    n: sorted.length,
    p50: r(percentile(sorted, 50)),
    p75: r(percentile(sorted, 75)),
    p95: r(percentile(sorted, 95)),
    p99: r(percentile(sorted, 99)),
    max: r(sorted.at(-1) ?? null),
  };
}

function parseServerTiming(header) {
  if (!header) return null;
  const out = {};
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    for (const p of params) {
      const [k, v] = p.split('=');
      out[`${name}.${k}`] = v?.replace(/"/g, '');
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sent = 0;

async function once(ep) {
  if (LIVE && sent >= LIVE_CAP) throw new Error(`live cap of ${LIVE_CAP} requests reached`);
  sent += 1;
  const body = typeof ep.body === 'function' ? ep.body(sent) : ep.body;
  const headers = body ? { 'content-type': 'application/json' } : {};
  // Local only: a distinct client IP per call (honoured by wrangler dev), for
  // the same rate-limit reason as above. Never sent to production.
  if (!LIVE) headers['cf-connecting-ip'] = `10.99.${Math.floor(sent / 250) % 250}.${sent % 250}`;
  const t0 = performance.now();
  const res = await fetch(`${BASE}${ep.path}`, {
    method: ep.method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.arrayBuffer();
  const ms = performance.now() - t0;
  return {
    ms,
    status: res.status,
    timing: parseServerTiming(res.headers.get('server-timing')),
    colo: res.headers.get('cf-ray')?.split('-')[1] ?? null,
  };
}

async function measure(ep) {
  const sequential = [];
  const statuses = {};
  const server = [];
  let colo = null;

  for (let i = 0; i < RUNS; i += 1) {
    const r = await once(ep);
    sequential.push(r.ms);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    if (r.timing) server.push(r.timing);
    colo ??= r.colo;
    if (LIVE) await sleep(1000);
  }

  let concurrent = null;
  if (!LIVE) {
    const samples = [];
    const queue = Array.from({ length: RUNS }, () => ep);
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const next = queue.pop();
        samples.push((await once(next)).ms);
      }
    }));
    concurrent = summarise(samples);
  }

  const serverTotals = server.map((t) => Number(t['total.dur'])).filter(Number.isFinite);
  const subreqs = server.map((t) => Number(t['subreq.desc'])).filter(Number.isFinite);

  return {
    endpoint: ep.name,
    statuses,
    colo,
    sequential: summarise(sequential),
    concurrent,
    serverTotal: serverTotals.length ? summarise(serverTotals) : null,
    subrequests: subreqs.length ? summarise(subreqs) : null,
  };
}

async function main() {
  const endpoints = LIVE ? READ_ONLY : [...READ_ONLY, ...LOCAL];
  const results = [];
  for (const ep of endpoints) results.push(await measure(ep));

  const report = { base: BASE, live: LIVE, runs: RUNS, concurrency: CONCURRENCY, at: new Date().toISOString(), results };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
  }
}

// fileURLToPath, not string matching: the repo path contains spaces, which the
// module URL percent-encodes.
const invokedDirectly = Boolean(process.argv[1]) && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
