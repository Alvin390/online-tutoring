import { apiPost } from './client';

/**
 * Bulk actions on students — 003Fixes / 05 (block, unblock, undo, list) and
 * 06 (approve receipts). One endpoint with an `action`, like sessions/manage.
 *
 * A selection larger than the server's chunk size is sent as consecutive
 * calls sharing one `batchId`, so the teacher sees one action (and one Undo)
 * however many calls it took. Calls are sequential: kinder to a weak phone
 * connection than parallel ones, and progress reads in order.
 */

/** The server's chunk sizes (it reports its own in `limits`; these match). */
export const DEFAULT_LIMITS = Object.freeze({ block: 25, blockFees: 8, unblock: 25, approveReceipts: 8 });

const call = (body) => apiPost('/api/students/bulk', body, { retry: 1 });

export const listBulkActions = () => call({ action: 'list' });

/** Interrupted part-way: what was done, and where to carry on from. */
export class BulkInterrupted extends Error {
  constructor(cause, partial) {
    super(cause?.message ?? 'The connection dropped part-way through.');
    this.name = 'BulkInterrupted';
    this.cause = cause;
    this.partial = partial;
  }
}

const mergeSkipped = (into, from = {}) => {
  for (const [key, n] of Object.entries(from)) into[key] = (into[key] ?? 0) + n;
  return into;
};

/**
 * Runs one bulk action over `items` ([{ session, phone }]), chunk by chunk.
 *
 * @param {object} opts
 * @param {'block'|'unblock'|'approveReceipts'} opts.action
 * @param {Array<{session: string, phone: string}>} opts.items
 * @param {'fees'|'other'} [opts.kind]    block only
 * @param {number} [opts.amount]          block, kind fees
 * @param {string} [opts.reason]          block, kind other
 * @param {object} [opts.limits]
 * @param {(done: number, total: number) => void} [opts.onProgress]
 * @param {{ batchId: string, next: number, result: object }} [opts.resume]  from a BulkInterrupted
 */
export async function runBulk({ action, items, kind, amount, reason, limits = DEFAULT_LIMITS, onProgress, resume = null }) {
  const size = action === 'block' && kind === 'fees' ? limits.blockFees : limits[action];
  let batchId = resume?.batchId ?? null;
  const result = resume?.result ?? { done: 0, skipped: {}, failed: [], undoUntilMs: null };
  let next = resume?.next ?? 0;

  onProgress?.(next, items.length);
  while (next < items.length) {
    const chunk = items.slice(next, next + size);
    let res;
    try {
      res = await call({
        action,
        items: chunk,
        ...(action === 'block' ? { kind } : {}),
        ...(action === 'block' && kind === 'fees' ? { amount } : {}),
        ...(action === 'block' && kind !== 'fees' && reason ? { reason } : {}),
        ...(batchId ? { batchId } : {}),
      });
    } catch (error) {
      // Nothing returned for this chunk: carry on from it, under the same batch.
      if (next === 0 && !batchId) throw error;
      throw new BulkInterrupted(error, { batchId, next, result, total: items.length });
    }
    batchId = res.batchId;
    result.done += res.done;
    mergeSkipped(result.skipped, res.skipped);
    result.failed.push(...(res.failed ?? []).map((f) => ({ ...f, index: f.index + next })));
    result.undoUntilMs = res.undoUntilMs;
    next += chunk.length;
    onProgress?.(next, items.length);
  }
  return { ...result, batchId, total: items.length };
}

/** Undoes a batch, repeating until the server says nothing remains. */
export async function undoBulk(batchId, onProgress) {
  const totals = { undone: 0, changedSince: 0, missing: 0, failed: 0 };
  for (;;) {
    const res = await call({ action: 'undo', batchId });
    for (const key of Object.keys(totals)) totals[key] += res[key] ?? 0;
    onProgress?.(totals.undone + totals.changedSince + totals.missing + totals.failed);
    if (!res.remaining) return { ...totals, status: res.status };
  }
}
