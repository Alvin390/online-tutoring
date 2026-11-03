/**
 * A short note of the device behind a staff change — 004Fixes / 05.
 *
 * Browser and OS (from the user-agent) and Cloudflare's name for the network
 * (`req.network`, set by worker/nodeCompat.js from `request.cf.asOrganization`).
 * Stored on bulk actions, schedules and their audit entries, because
 * Cloudflare keeps its own request logs for only 3 days — and on 30 Oct the
 * device was what told a confirmed undo from a stray click.
 *
 * Deliberately coarse: never an IP address, never the full user-agent.
 */

const BROWSERS = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[.\d]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
];

const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows NT/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const MAX_NETWORK = 60;

/** @returns {{ browser: string|null, os: string|null, network: string|null }} */
export function describeDevice(req) {
  const ua = String(req?.headers?.['user-agent'] ?? '');
  let browser = null;
  for (const [pattern, name] of BROWSERS) {
    const match = pattern.exec(ua);
    if (match) { browser = `${name} ${match[1]}`; break; }
  }
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const network = typeof req?.network === 'string' && req.network.trim() ? req.network.trim().slice(0, MAX_NETWORK) : null;
  return { browser, os, network };
}

/** The signed-in staff member with their device, for `createdBy` / `lastChangedBy`. */
export function withDevice(user, req) {
  return { ...user, device: describeDevice(req) };
}
