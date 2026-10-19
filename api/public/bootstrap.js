import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getPublicBootstrap } from '../_lib/publicBootstrap.js';

/**
 * Everything a public page needs, in one request — Phase 13 / 08 A1.
 *
 *   GET /api/public/bootstrap → { flags, sessions }
 *
 * The homepage and the class pages used to open the Firestore SDK (~130 KB gz)
 * just to read the flags document and the active sessions. Both are public by
 * design (booleans, and what a session card shows), so the Worker serves them.
 *
 * CACHING. Production runs on `*.workers.dev`, where the Workers Cache API is
 * a no-op (it needs a custom domain), so the edge cache the plan proposed would
 * do nothing there. Instead:
 *   - a per-isolate memory cache (60 s) — most requests cost no Firestore call;
 *   - `Cache-Control: public, max-age=60, stale-while-revalidate=300` for the
 *     browser and any shared cache in front of a future custom domain.
 * A session or flag change is visible within ~60 s. `invalidateBootstrap()` is
 * called by the writes that change it, which clears THIS isolate at once.
 *
 * Returns no personal data: flags and session presentation fields only.
 */

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  try {
    const payload = await getPublicBootstrap();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
  } catch (err) {
    createLogger(randomUUID()).error('Public bootstrap failed', err);
    // The client falls back to defaults (flags off, morning + evening).
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: { code: 'unavailable' } });
  }
}
