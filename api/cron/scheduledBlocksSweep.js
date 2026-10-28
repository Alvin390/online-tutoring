import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { subrequestsSpent, SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { applyDueSchedules } from '../_lib/scheduledBlocks.js';

/**
 * Applies scheduled blocks that are due — 003Fixes / 07. Runs every minute
 * (wrangler.jsonc "* * * * *"); also reachable as a POST with CRON_SECRET for
 * a manual run. With nothing due it costs one query.
 *
 * Students are refused class from the scheduled minute regardless (check-in
 * and the class link read `scheduledBlock` themselves); this records the
 * block properly — the fee charge, the block fields, the Undo record.
 */

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const explicit = req.headers['x-cron-secret'];
  return (
    (bearer != null && safeCompare(bearer, secret))
    || (typeof explicit === 'string' && safeCompare(explicit, secret))
  );
}

export default async function handler(req, res) {
  const log = createLogger(randomUUID());
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }
  if (!authorized(req)) {
    log.warn('Unauthorized scheduled-blocks sweep invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  let result = {};
  try {
    result = await applyDueSchedules({ db: getDb(), nowMs: Date.now(), log });
  } catch (err) {
    if (!(err instanceof SubrequestBudgetExceeded)) {
      log.error('Scheduled-blocks sweep failed', err);
      return res.status(500).json({ error: { code: 'sweep_failed' } });
    }
    log.warn('Scheduled-blocks sweep ran out of budget; the next run continues');
  }
  if (result.schedules) log.info('Scheduled blocks applied', result);
  return res.status(200).json({ ok: true, ...result, subrequests: subrequestsSpent() });
}
