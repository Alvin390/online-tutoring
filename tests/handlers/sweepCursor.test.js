import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * Resumable sweep cursors — Phase 12 D5.
 *
 * Cloudflare's free plan gives an invocation 50 external subrequests, so the
 * cron sweeps can no longer run to completion in one go. They now do a bounded
 * chunk and resume. The property that matters is that resuming covers EVERY
 * item exactly once across the ticks — a sweep that silently skipped students
 * would under-invoice, and one that repeated them would rely entirely on
 * downstream idempotency to avoid double-charging.
 */

let sweep;
let rest;
let db;

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT ??= 'demo-online-tutoring';
  process.env.METADATA_SERVER_DETECTION ??= 'none';
  process.env.GCE_METADATA_HOST ??= '0.0.0.0';

  sweep = await import('../../api/_lib/sweepCursor.js');
  rest = await import('../../api/_lib/firestoreRest.js');
  ({ getDb: db } = await import('../../api/_lib/firebaseAdmin.js'));
});

const NAME = 'test_sweep';

beforeEach(async () => {
  delete process.env.SWEEP_BATCH_SIZE;
  rest.armSubrequestBudget(Infinity);
  await db().doc(`system/sweeps/state/${NAME}`).delete();
});

afterEach(() => {
  rest.armSubrequestBudget(Infinity);
  delete process.env.SWEEP_BATCH_SIZE;
});

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `item_${String(i).padStart(3, '0')}` }));
const keyOf = (item) => item.id;

describe('runResumable', () => {
  it('covers every item exactly once across successive ticks', async () => {
    const all = items(10);
    const seen = [];

    let guard = 0;
    let complete = false;
    while (!complete && guard < 20) {
      // eslint-disable-next-line no-await-in-loop
      const result = await sweep.runResumable({
        name: NAME,
        items: all,
        keyOf,
        handle: async (item) => { seen.push(item.id); },
        budget: 3,
      });
      complete = result.complete;
      guard += 1;
    }

    expect(complete).toBe(true);
    // Exactly once, in order, no gaps and no repeats. This is the whole
    // contract — anything else means a student was skipped or billed twice.
    expect(seen).toEqual(all.map(keyOf));
    expect(guard).toBe(4); // 3 + 3 + 3 + 1
  });

  it('reports resumption on the second tick, not the first', async () => {
    const all = items(5);

    const first = await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async () => {}, budget: 2,
    });
    expect(first).toMatchObject({ processed: 2, resumed: false, complete: false });

    const second = await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async () => {}, budget: 2,
    });
    expect(second).toMatchObject({ processed: 2, resumed: true, complete: false });
  });

  it('clears the cursor and counts a cycle on completion', async () => {
    const all = items(2);

    await sweep.runResumable({ name: NAME, items: all, keyOf, handle: async () => {}, budget: 10 });

    const state = await sweep.readCursor(NAME);
    // A null cursor means "start from the beginning next time" — a stale
    // cursor left behind would make the next month's run skip everyone before
    // the last student of the previous run.
    expect(state.cursor).toBeNull();
    expect(state.cycles).toBe(1);
  });

  it('starts the next cycle from the beginning', async () => {
    const all = items(3);
    const first = [];
    const second = [];

    await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async (i) => { first.push(i.id); }, budget: 10,
    });
    await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async (i) => { second.push(i.id); }, budget: 10,
    });

    expect(second).toEqual(first);
  });

  it('restarts rather than skipping when the cursor no longer resolves', async () => {
    // The stored item was deleted, or the query shape changed. Re-processing is
    // safe because every sweep operation is idempotent; silently skipping the
    // rest of the roster is not.
    await sweep.writeCursor(NAME, 'item_that_no_longer_exists');

    const seen = [];
    const result = await sweep.runResumable({
      name: NAME, items: items(4), keyOf, handle: async (i) => { seen.push(i.id); }, budget: 10,
    });

    expect(result.complete).toBe(true);
    expect(seen).toHaveLength(4);
  });

  it('handles an empty item list without leaving a cursor behind', async () => {
    const result = await sweep.runResumable({
      name: NAME, items: [], keyOf, handle: async () => {}, budget: 5,
    });

    expect(result).toMatchObject({ processed: 0, complete: true });
    expect((await sweep.readCursor(NAME)).cursor).toBeNull();
  });

  it('stops on the reserve before any handler is interrupted', async () => {
    // The happy path for the budget brake: shouldYield fires between items, so
    // no handler is ever cut off part-way and the cursor points at genuinely
    // completed work.
    const all = items(6);
    const finished = [];

    rest.armSubrequestBudget(8);
    const result = await sweep.runResumable({
      name: NAME,
      items: all,
      keyOf,
      handle: async (item) => {
        await db().doc(`system/sweeps/scratch/${item.id}`).get();
        finished.push(item.id);
      },
      budget: 100,
    });
    rest.armSubrequestBudget(Infinity);

    expect(result.complete).toBe(false);
    expect(finished.length).toBeGreaterThan(0);
    expect((await sweep.readCursor(NAME)).cursor).toBe(finished[finished.length - 1]);
  });

  it('does not record an interrupted item as done', async () => {
    // A single item that costs more than the reserve blows past the brake and
    // throws mid-flight. The cursor must NOT advance over it.
    const all = items(6);
    const started = [];

    rest.armSubrequestBudget(8);
    const result = await sweep.runResumable({
      name: NAME,
      items: all,
      keyOf,
      handle: async (item) => {
        started.push(item.id);
        for (let i = 0; i < 10; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await db().doc(`system/sweeps/scratch/${item.id}_${i}`).get();
        }
      },
      budget: 100,
    });
    rest.armSubrequestBudget(Infinity);

    expect(result.complete).toBe(false);
    expect(result.processed).toBe(0);

    const interrupted = started[started.length - 1];
    expect((await sweep.readCursor(NAME)).cursor).not.toBe(interrupted);

    // And the next tick picks that item back up.
    const resumed = [];
    await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async (i) => { resumed.push(i.id); }, budget: 100,
    });
    expect(resumed).toContain(interrupted);
  });

  it('holds a resumed cursor when the first item of a tick is interrupted', async () => {
    // Regression: writeCursor used to infer completion from a null cursor. A
    // tick that finished nothing has no key to write — but it has not finished
    // the CYCLE either, and clearing the cursor would send the next tick back
    // to the start of the roster and re-process everything already done.
    const all = items(6);

    await sweep.runResumable({
      name: NAME, items: all, keyOf, handle: async () => {}, budget: 2,
    });
    const before = await sweep.readCursor(NAME);
    expect(before.cursor).toBe('item_001');

    rest.armSubrequestBudget(8);
    const result = await sweep.runResumable({
      name: NAME,
      items: all,
      keyOf,
      handle: async (item) => {
        for (let i = 0; i < 10; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await db().doc(`system/sweeps/scratch/${item.id}_${i}`).get();
        }
      },
      budget: 100,
    });
    rest.armSubrequestBudget(Infinity);

    expect(result.processed).toBe(0);

    const after = await sweep.readCursor(NAME);
    expect(after.cursor).toBe('item_001');
    expect(after.cycles).toBe(0); // NOT counted as a completed cycle
  });
});

describe('shouldYield', () => {
  it('yields once the item budget is spent', () => {
    expect(sweep.shouldYield(2, 3)).toBe(false);
    expect(sweep.shouldYield(3, 3)).toBe(true);
  });

  it('yields early when the subrequest budget is nearly gone', () => {
    // Reserving headroom is what guarantees the sweep can still WRITE its
    // cursor. Without it a stalled sweep repeats the same chunk forever.
    rest.armSubrequestBudget(3);
    expect(sweep.shouldYield(0, 100)).toBe(true);
    rest.armSubrequestBudget(Infinity);
  });

  it('does not yield when the budget is unarmed, as in plain Node', () => {
    rest.armSubrequestBudget(Infinity);
    expect(sweep.shouldYield(0, 100)).toBe(false);
  });
});

describe('sweepBatchSize', () => {
  it('defaults to a value safe for the free plan', () => {
    expect(sweep.sweepBatchSize()).toBe(8);
    expect(sweep.sweepBatchSize(3)).toBe(3);
  });

  it('is raisable for Workers Paid without a code change', () => {
    process.env.SWEEP_BATCH_SIZE = '100';
    expect(sweep.sweepBatchSize()).toBe(100);
  });

  it('ignores nonsense rather than sweeping zero items forever', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.SWEEP_BATCH_SIZE = bad;
      expect(sweep.sweepBatchSize()).toBe(8);
    }
  });
});
