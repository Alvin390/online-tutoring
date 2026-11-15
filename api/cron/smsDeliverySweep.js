import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { subrequestsSpent, SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { deliverySweep } from '../_lib/smsCampaign.js';

/**
 * SMS delivery reports — 008Fixes / 07 (owner answer 5: no new cron). Runs on
 * the every-minute trigger, after the scheduled-blocks sweep, sharing its
 * subrequest budget. Only messages sent in the last 30 minutes are checked
 * (`config/smsPending`); with none, it costs one read. Also reachable as a
 * POST with CRON_SECRET for a manual run.
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
    log.warn('Unauthorized SMS delivery sweep invocation');
    return res.status(401).json({ error: { code: 'unauthorized' } });
  }

  let result = {};
  try {
    result = await deliverySweep({ db: getDb(), nowMs: Date.now(), log });
  } catch (err) {
    if (!(err instanceof SubrequestBudgetExceeded)) {
      log.error('SMS delivery sweep failed', err);
      return res.status(500).json({ error: { code: 'sweep_failed' } });
    }
    log.warn('SMS delivery sweep ran out of budget; the next run continues');
  }
  if (result.checked) log.info('SMS delivery checked', result);
  return res.status(200).json({ ok: true, ...result, subrequests: subrequestsSpent() });
}
