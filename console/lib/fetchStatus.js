import { signConsoleRequest } from '../../api/_lib/consoleSignature.js';

/**
 * One school's status, from its signed status link (phase 37) — 013Fixes / 38b.
 *
 * Transport: a Service Binding when the registry names one (env[binding]),
 * otherwise a plain fetch. The console and the schools share the workers.dev
 * zone, where a Worker's fetch to another Worker fails (Cloudflare error
 * 1042) — console/wrangler.jsonc sets global_fetch_strictly_public so the
 * fetch goes over the public internet like any client.
 *
 * Never throws: a school that can't be reached is { reachable: false, error }.
 */

export const STATUS_PATH = '/api/platform/status';
export const TIMEOUT_MS = 5_000;

export async function fetchSchoolStatus(school, env, { fetchImpl = (...a) => fetch(...a), now = Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  const secret = env?.[school.secretRef || 'CONSOLE_SECRET'];
  if (!secret) return { reachable: false, error: `no secret set (${school.secretRef || 'CONSOLE_SECRET'})` };

  const url = `${school.url}${STATUS_PATH}`;
  const host = new URL(school.url).host;
  const headers = signConsoleRequest(secret, { method: 'GET', host, path: STATUS_PATH, timestamp: now });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const binding = school.binding ? env?.[school.binding] : null;
    const res = typeof binding?.fetch === 'function'
      ? await binding.fetch(new Request(url, { method: 'GET', headers, signal: controller.signal }))
      : await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (res.status === 401) return { reachable: false, error: 'signature refused (check the secret on both sides)' };
    if (res.status === 404) return { reachable: false, error: 'the status link is off (no CONSOLE_SECRET on the school)' };
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const status = await res.json();
    return { reachable: true, status };
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) return { reachable: false, error: `no answer within ${Math.round(timeoutMs / 1000) || 1} s` };
    return { reachable: false, error: 'no answer: the address may be wrong, or the school is down' };
  } finally {
    clearTimeout(timer);
  }
}
