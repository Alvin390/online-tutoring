import { describe, it, expect, vi, afterEach } from 'vitest';
import { runBulk, undoBulk, BulkInterrupted } from '@services/api/students';

/**
 * 003Fixes / 05 — the client side of bulk actions: chunking to the server's
 * size, one batch id across calls, progress, carrying on after a dropped
 * connection, and undo until nothing remains.
 */

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const items = (n) => Array.from({ length: n }, (_, i) => ({ session: 'morning', phone: `+2547110${String(i).padStart(5, '0')}` }));
const sent = (fetchMock) => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('runBulk', () => {
  it('30 students at 10 a call: three calls, one batch, progress 0/10/20/30', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ batchId: 'B1', done: 10, skipped: { alreadyBlocked: 1 }, failed: [], undoUntilMs: 9 }))
      .mockResolvedValueOnce(ok({ batchId: 'B1', done: 9, skipped: {}, failed: [{ index: 3, code: 'charge_failed' }], undoUntilMs: 9 }))
      .mockResolvedValueOnce(ok({ batchId: 'B1', done: 10, skipped: { alreadyBlocked: 1 }, failed: [], undoUntilMs: 9 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress = [];
    const result = await runBulk({
      action: 'block', kind: 'fees', amount: 1500, items: items(30),
      limits: { blockFees: 10 }, onProgress: (d, t) => progress.push(`${d}/${t}`),
    });
    const bodies = sent(fetchMock);
    expect(bodies).toHaveLength(3);
    expect(bodies.map((b) => b.items.length)).toEqual([10, 10, 10]);
    expect(bodies[0]).toMatchObject({ action: 'block', kind: 'fees', amount: 1500 });
    expect(bodies[0].batchId).toBeUndefined();
    expect(bodies[1].batchId).toBe('B1');
    expect(bodies[2].batchId).toBe('B1');
    expect(progress).toEqual(['0/30', '10/30', '20/30', '30/30']);
    expect(result).toMatchObject({ batchId: 'B1', done: 29, skipped: { alreadyBlocked: 2 }, total: 30 });
    // A failure's index is relative to the whole selection, not its chunk.
    expect(result.failed).toEqual([{ index: 13, code: 'charge_failed' }]);
  });

  it('a plain block sends the reason, not an amount; unblock sends neither', async () => {
    // A fresh Response per call: a body can be read once.
    const fetchMock = vi.fn().mockImplementation(async () => ok({ batchId: 'B2', done: 1, skipped: {}, failed: [], undoUntilMs: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await runBulk({ action: 'block', kind: 'other', reason: 'Fees for next week', items: items(1) });
    await runBulk({ action: 'unblock', items: items(1) });
    const [block, unblock] = sent(fetchMock);
    expect(block).toEqual({ action: 'block', kind: 'other', reason: 'Fees for next week', items: items(1) });
    expect(unblock).toEqual({ action: 'unblock', items: items(1) });
  });

  it('a dropped connection after the first call: BulkInterrupted says how far it got, and resuming finishes the same batch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ batchId: 'B3', done: 25, skipped: {}, failed: [], undoUntilMs: 1 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')); // the one retry
    vi.stubGlobal('fetch', fetchMock);
    const err = await runBulk({ action: 'block', kind: 'other', items: items(40) }).catch((e) => e);
    expect(err).toBeInstanceOf(BulkInterrupted);
    expect(err.partial).toMatchObject({ batchId: 'B3', next: 25, total: 40 });

    fetchMock.mockResolvedValueOnce(ok({ batchId: 'B3', done: 15, skipped: {}, failed: [], undoUntilMs: 1 }));
    const result = await runBulk({ action: 'block', kind: 'other', items: items(40), resume: err.partial });
    const last = sent(fetchMock).at(-1);
    expect(last.batchId).toBe('B3');
    expect(last.items).toHaveLength(15);
    expect(result).toMatchObject({ done: 40, batchId: 'B3' });
  });

  it('a failure on the very first call is an ordinary error (nothing was done)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'tier_required', message: 'Silver' } }), { status: 403 })));
    const err = await runBulk({ action: 'block', kind: 'fees', amount: 10, items: items(3) }).catch((e) => e);
    expect(err).not.toBeInstanceOf(BulkInterrupted);
    expect(err).toMatchObject({ status: 403, code: 'tier_required' });
  });
});

describe('undoBulk', () => {
  it('repeats until nothing remains, adding up the counts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok({ status: 'undoing', remaining: true, undone: 20, changedSince: 0, missing: 0, failed: 0 }))
      .mockResolvedValueOnce(ok({ status: 'undone', remaining: false, undone: 4, changedSince: 1, missing: 0, failed: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const progress = [];
    const res = await undoBulk('B9', (n) => progress.push(n));
    expect(sent(fetchMock)).toEqual([{ action: 'undo', batchId: 'B9' }, { action: 'undo', batchId: 'B9' }]);
    expect(res).toMatchObject({ undone: 24, changedSince: 1, status: 'undone' });
    expect(progress).toEqual([20, 25]);
  });
});
