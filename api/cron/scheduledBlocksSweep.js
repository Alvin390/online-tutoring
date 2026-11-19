import { randomUUID } from 'node:crypto';
import { createLogger } from '../_lib/log.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { safeCompare } from '../_lib/crypto.js';
import { subrequestsSpent, SubrequestBudgetExceeded } from '../_lib/firestoreRest.js';
import { applyDueSchedules, cancelWaitingSchedules } from '../_lib/scheduledBlocks.js';
import { schoolPlan } from '../_lib/schoolPlan.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Applies scheduled blocks that are due — 003Fixes / 07. Runs every minute
 * (wrangler.jsonc "* * * * *"); also reachable as a POST with CRON_SECRET for
 * a manual run. With nothing waiting it costs one query (013Fixes / 03: the
 * school's plan is read only when something is waiting).
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

  const db = getDb();

  // Nothing waiting at all (the usual minute): one query, as before — the
  // plan is only read when there is something to apply or cancel.
  const waiting = await db.collection('scheduledBlocks').where('dueAtMs', '>=', 0).limit(1).get();
  if (waiting.empty) return res.status(200).json({ ok: true, schedules: 0, subrequests: subrequestsSpent() });

  // 013Fixes / 03: scheduled blocks are a plan feature (Silver and up). A cron
  // passes no HTTP gate, so the sweep checks the school's plan itself, every
  // run. Can't read it: do nothing this run (never apply or cancel on a guess).
  let plan;
  try {
    plan = await schoolPlan(db);
  } catch (err) {
    log.warn('Scheduled-blocks sweep skipped: the plan could not be read', { code: err?.code });
    return res.status(200).json({ ok: true, skipped: 'plan_unavailable' });
  }
  if (plan.features.scheduledBlocks !== true) {
    const system = { uid: 'system:plan', role: 'system' };
    let cancelled = [];
    try {
      cancelled = await cancelWaitingSchedules({ db, user: system, because: 'plan' });
    } catch (err) {
      if (!(err instanceof SubrequestBudgetExceeded)) {
        log.error('Cancelling schedules for the plan failed', err);
        return res.status(500).json({ error: { code: 'sweep_failed' } });
      }
    }
    for (const id of cancelled) {
      await tryWriteAudit({
        action: 'students.schedule_cancelled_plan', actor: 'system:scheduledBlocks', actorRole: 'system',
        target: `scheduledBlocks/${id}`, after: { tier: plan.tier ?? null }, context: { reason: 'plan_without_scheduled_blocks' },
      }, log);
    }
    if (cancelled.length) log.info('Scheduled blocks cancelled: not in the plan', { count: cancelled.length, tier: plan.tier });
    return res.status(200).json({ ok: true, cancelledForPlan: cancelled.length, subrequests: subrequestsSpent() });
  }

  let result = {};
  try {
    result = await applyDueSchedules({ db, nowMs: Date.now(), log });
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
