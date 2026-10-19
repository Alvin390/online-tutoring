import { getDb } from './firebaseAdmin.js';
import { getFlags } from './flags.js';

/**
 * Public bootstrap data and its per-isolate cache — Phase 13 / 08 A1.
 * Served by api/public/bootstrap.js; cleared by invalidateSession() on every
 * session write.
 */

const TTL_MS = 60_000;
const PUBLIC_SESSION_FIELDS = ['name', 'description', 'schedule', 'icon', 'gradient', 'order'];

let cached = null;
let cachedAt = 0;

export function invalidateBootstrap() {
  cached = null;
  cachedAt = 0;
}

async function load() {
  const [flags, snap] = await Promise.all([
    getFlags(),
    getDb().collection('sessions').where('active', '==', true).get(),
  ]);
  const sessions = snap.docs
    .map((d) => {
      const data = d.data();
      const out = { slug: d.id };
      for (const key of PUBLIC_SESSION_FIELDS) if (data[key] !== undefined) out[key] = data[key];
      return out;
    })
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return { flags, sessions };
}

/** The cached payload, reloading it when older than TTL_MS. */
export async function getPublicBootstrap() {
  if (!cached || Date.now() - cachedAt > TTL_MS) {
    cached = await load();
    cachedAt = Date.now();
  }
  return cached;
}
