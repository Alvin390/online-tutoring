import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 007Fixes / 07 — the dashboard's calls to POST /api/students/staff. A large
 * selection goes in chunks of 25 under ONE operation id (the server keys the
 * balance closures by it, so a retried chunk never closes twice); each call
 * may be retried once; skips come back by their place in the whole selection.
 */

let apiPost;
beforeEach(() => {
  vi.resetModules();
  apiPost = vi.fn(async (_path, body) => (body.action === 'mark'
    ? { ok: true, marked: body.items.length - 1, closedBalances: [{ session: 'evening', amount: 100 }], closedTotal: 100, skipped: [{ index: 0, reason: 'alreadyStaff' }] }
    : { ok: true, unmarked: body.items.length, skipped: [] }));
  vi.doMock('@services/api/client', () => ({ apiPost }));
  vi.doMock('../../../src/services/api/client', () => ({ apiPost }));
});

const people = (n) => Array.from({ length: n }, (_, i) => ({ session: 'evening', phone: `+2547000${String(i).padStart(5, '0')}` }));

describe('markStaff', () => {
  it('30 people: two calls of 25 and 5, one opId, retry once, totals added up, skips by overall index', async () => {
    const { markStaff } = await import('@services/api/students');
    const progress = vi.fn();
    const res = await markStaff(people(30), { alsoOtherSession: true, onProgress: progress });
    expect(apiPost).toHaveBeenCalledTimes(2);
    const [[path1, body1, opts1], [, body2]] = apiPost.mock.calls;
    expect(path1).toBe('/api/students/staff');
    expect(opts1).toMatchObject({ retry: 1 });
    expect(body1).toMatchObject({ action: 'mark', alsoOtherSession: true });
    expect(body1.items).toHaveLength(25);
    expect(body2.items).toHaveLength(5);
    expect(body1.opId).toMatch(/^[A-Za-z0-9]{1,40}$/);
    expect(body2.opId).toBe(body1.opId);
    expect(res).toMatchObject({ marked: 28, closedTotal: 200 });
    expect(res.closedBalances).toHaveLength(2);
    expect(res.skipped).toEqual([{ index: 0, reason: 'alreadyStaff' }, { index: 25, reason: 'alreadyStaff' }]);
    expect(progress).toHaveBeenLastCalledWith(30, 30);
  });

  it('each new marking gets a new opId', async () => {
    const { markStaff } = await import('@services/api/students');
    await markStaff(people(1));
    await markStaff(people(1));
    expect(apiPost.mock.calls[0][1].opId).not.toBe(apiPost.mock.calls[1][1].opId);
  });
});

describe('unmarkStaff', () => {
  it('chunks of 25, retry once, counts added up', async () => {
    const { unmarkStaff } = await import('@services/api/students');
    const res = await unmarkStaff(people(26));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost.mock.calls[0][1]).toMatchObject({ action: 'unmark' });
    expect(apiPost.mock.calls[0][2]).toMatchObject({ retry: 1 });
    expect(res).toMatchObject({ unmarked: 26, skipped: [] });
  });
});
