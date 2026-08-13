import { getDb, FieldValue } from './firebaseAdmin.js';
import {
  SubrequestBudgetExceeded,
  subrequestsRemaining,
  withSubrequestAllowance,
} from './firestoreRest.js';

/**
 * Resumable sweep cursors — Phase 12 D5.
 *
 * The three cron sweeps used to run to completion in one invocation. On Vercel
 * that was fine. On Cloudflare Workers it is not: the free plan allows 50
 * external subrequests and 10ms of CPU per invocation, and a Firestore REST
 * call spends one subrequest. `runInvoiceGeneration` costs roughly four per
 * student (an account read plus a transaction), so it would stop dead somewhere
 * around the twelfth student — mid-run, with no record of where.
 *
 * So a sweep now does a BOUNDED chunk, writes down where it stopped, and picks
 * up there next time. `mpesaReconcile` runs every ten minutes and so drains
 * within the hour; `feesSweep` runs nightly and carries over to the next night
 * only if the roster is very large.
 *
 * The cursor is stored rather than held in memory because a Worker isolate does
 * not survive between cron firings.
 *
 * Cursors live at `system/sweeps/state/{name}` — four segments, an even count,
 * which is what makes it a document path.
 */

const COLLECTION = 'system/sweeps/state';

/**
 * Leave this much of the subrequest budget unspent.
 *
 * A sweep that stops with nothing left over cannot write its own cursor, and a
 * cursor that was not written means the next run repeats the same chunk
 * forever. The reserve is what guarantees there is always enough left to
 * record progress.
 */
const CURSOR_WRITE_RESERVE = 4;

export function sweepRef(name) {
  return getDb().doc(`${COLLECTION}/${name}`);
}

/**
 * @returns {Promise<{cursor: string|null, startedAt: number|null, cycles: number}>}
 */
export async function readCursor(name) {
  const snap = await sweepRef(name).get();
  if (!snap.exists) return { cursor: null, startedAt: null, cycles: 0 };

  const data = snap.data();
  return {
    cursor: data.cursor ?? null,
    startedAt: data.startedAt?.toMillis?.() ?? null,
    cycles: data.cycles ?? 0,
  };
}

/**
 * Records where the sweep stopped.
 *
 * `complete` is passed EXPLICITLY rather than inferred from a null cursor, and
 * that distinction is load-bearing. A tick whose very first item is interrupted
 * has no key to record — but it has not finished the cycle either. Inferring
 * completion from the null would clear a resumed cursor and send the next tick
 * back to the start of the roster, re-processing everything it had already
 * done and falsely reporting a completed cycle to monitoring.
 *
 * A completed cycle bumps `cycles`, which is how monitoring tells a sweep that
 * is making progress from one stuck part-way through.
 */
export async function writeCursor(name, cursor, { processed = 0, complete = false } = {}) {
  // Privileged: this must succeed even when the sweep stopped because the
  // subrequest budget ran out. `shouldYield` reserves headroom for it, but a
  // single item costing more than the reserve overshoots — and a sweep that
  // cannot record its cursor repeats the same chunk on every firing, forever.
  await withSubrequestAllowance(2, () =>
    sweepRef(name).set(
      {
        cursor,
        lastRunAt: FieldValue.serverTimestamp(),
        lastProcessed: processed,
        ...(complete
          ? { cycles: FieldValue.increment(1), completedAt: FieldValue.serverTimestamp(), startedAt: null }
          : {}),
      },
      { merge: true }
    ));
}

export async function clearCursor(name) {
  await writeCursor(name, null, { complete: true });
}

/**
 * Should the sweep stop and resume next tick?
 *
 * Two independent brakes:
 *   - the item budget, so one tick cannot run unboundedly long on CPU;
 *   - the remaining subrequest allowance, so it never runs out mid-item.
 *
 * @param {number} processed  items handled so far this tick
 * @param {number} budget     max items per tick
 */
export function shouldYield(processed, budget) {
  if (processed >= budget) return true;
  return subrequestsRemaining() <= CURSOR_WRITE_RESERVE;
}

/**
 * How many items a single tick may process.
 *
 * Overridable per deployment: on Workers Paid the subrequest ceiling rises from
 * 50 to 1,000 and CPU from 10ms to 30s, at which point a much larger batch is
 * both safe and faster. Raising this is the only change that move requires.
 */
export function sweepBatchSize(fallback = 8) {
  const configured = Number(process.env.SWEEP_BATCH_SIZE);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

/**
 * Runs `handler` over `items`, stopping cleanly at the budget and saving the
 * cursor either way.
 *
 * `keyOf` must return a stable, ORDER-CONSISTENT key — a document ID from a
 * query with a deterministic sort. The resume works by skipping everything up
 * to and including the stored key, so an unstable ordering would skip the wrong
 * items and, on a fee sweep, silently miss students.
 *
 * @param {object}   opts
 * @param {string}   opts.name
 * @param {Array}    opts.items      already ordered
 * @param {Function} opts.keyOf      (item) => string
 * @param {Function} opts.handle     async (item) => void
 * @param {number}   [opts.budget]
 * @param {object}   [opts.log]
 * @returns {Promise<{processed: number, resumed: boolean, complete: boolean}>}
 */
export async function runResumable({ name, items, keyOf, handle, budget, log }) {
  const limit = budget ?? sweepBatchSize();
  const { cursor } = await readCursor(name);

  let startIndex = 0;
  if (cursor) {
    const at = items.findIndex((item) => keyOf(item) === cursor);
    // A cursor that no longer matches anything — the document was deleted, or
    // the query shape changed — restarts the cycle rather than skipping
    // everything. Re-processing is safe (every sweep operation is idempotent);
    // skipping silently is not.
    startIndex = at === -1 ? 0 : at + 1;
    if (at === -1 && log) log.warn('Sweep cursor no longer resolves; restarting cycle', { name });
  }

  let processed = 0;
  let lastKey = null;
  let complete = true;

  for (let i = startIndex; i < items.length; i += 1) {
    if (shouldYield(processed, limit)) {
      complete = false;
      break;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await handle(items[i]);
    } catch (err) {
      if (err instanceof SubrequestBudgetExceeded) {
        // Stop BEFORE recording this item as done, so the next tick retries it.
        complete = false;
        break;
      }
      throw err;
    }

    lastKey = keyOf(items[i]);
    processed += 1;
  }

  if (complete) {
    // Reaching the end of a resumed pass completes the cycle.
    await writeCursor(name, null, { processed, complete: true });
  } else {
    // Nothing finished this tick — the first item was interrupted. HOLD the
    // existing cursor rather than writing null, or a resumed sweep would be
    // sent back to the start of the roster.
    await writeCursor(name, lastKey ?? cursor, { processed, complete: false });
  }

  return { processed, resumed: startIndex > 0, complete };
}
