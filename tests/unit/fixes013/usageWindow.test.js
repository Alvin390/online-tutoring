import { describe, it, expect } from 'vitest';
import { usageWindow, nairobiMonth } from '../../../api/_lib/usage.js';
import * as worker from '../../../worker/index.js';
import * as routes from '../../../worker/routes.js';

/**
 * 013Fixes / 11 — the usage window: a paying or trial school's own period; a
 * comp school (owner answer 2) the Nairobi calendar month. And where it runs:
 * the hourly trigger, after the subscription sweep (no new cron).
 */

const at = (iso) => Date.parse(iso);

describe('nairobiMonth', () => {
  it('starts at 00:00 Nairobi on the 1st (21:00 UTC the day before)', () => {
    const { start, end } = nairobiMonth(at('2026-11-20T05:00:00Z'));
    expect(new Date(start).toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-11-30T21:00:00.000Z');
  });

  it('just after midnight Nairobi on the 1st is the new month', () => {
    const { start } = nairobiMonth(at('2026-11-30T21:30:00Z')); // 00:30 on 1 Dec in Nairobi
    expect(new Date(start).toISOString()).toBe('2026-11-30T21:00:00.000Z');
  });
});

describe('usageWindow', () => {
  const now = at('2026-11-20T05:00:00Z');

  it('a paying or trial school: its own period', () => {
    const w = usageWindow({ currentPeriodStart: new Date('2026-11-14T13:00:00Z'), currentPeriodEnd: new Date('2026-12-14T13:00:00Z') }, now);
    expect(w).toEqual({ start: at('2026-11-14T13:00:00Z'), end: at('2026-12-14T13:00:00Z'), kind: 'period' });
  });

  it('a comp school: the Nairobi month, whatever its stored period', () => {
    const w = usageWindow({ grantedBySuperadmin: true, currentPeriodStart: new Date('2026-10-14T13:00:00Z') }, now);
    expect(w.kind).toBe('month');
    expect(new Date(w.start).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('no period, or one not started yet: the Nairobi month', () => {
    expect(usageWindow(null, now).kind).toBe('month');
    expect(usageWindow({ currentPeriodStart: new Date('2026-12-01T00:00:00Z') }, now).kind).toBe('month');
  });
});

describe('where it runs', () => {
  it('on the hourly trigger after the subscription sweep, reachable over HTTP', () => {
    expect(worker.CRON_SCHEDULE_TO_SWEEP['0 * * * *']).toEqual(['subscriptionSweep', 'usageCount']);
    expect(typeof routes.CRON_HANDLERS.usageCount).toBe('function');
    expect(routes.STATIC_ROUTES['/api/cron/usageCount']).toBeDefined();
  });
});
