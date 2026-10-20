import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
} from '../_worker.js';

/**
 * Phase 13 / 07 D3 (S-cal) — an "every occurrence" edit made from a later
 * occurrence must SHIFT the series, not move its first date (which deleted
 * every earlier occurrence). Validated before the fix: start went 5 Oct → 19 Oct.
 */

let db;
let gold;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p13-cal-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
});

// Monday 5 Oct 2026, 08:00–09:00 Nairobi (05:00Z), weekly on Mondays.
const SERIES_START = '2026-10-05T05:00:00.000Z';
const SERIES_END = '2026-10-05T06:00:00.000Z';
const OCC_19 = '2026-10-19T05:00:00.000Z';

const manage = (body) => call('/api/calendar/manage', { token: gold, body });
const series = async (id) => (await db.doc(`calendar/events/items/${id}`).get()).data();

async function createSeries() {
  const res = await manage({
    action: 'create', title: 'Maths', start: SERIES_START, end: SERIES_END,
    recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: null },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id;
}

describe('S-cal "every occurrence" edits', () => {
  it('moving the 19 Oct occurrence 08:00 → 09:00 moves the series to 5 Oct 09:00, keeping its first date', async () => {
    const id = await createSeries();
    const res = await manage({
      action: 'update', id, scope: 'all', occurrenceStart: OCC_19,
      title: 'Maths', start: '2026-10-19T06:00:00.000Z', end: '2026-10-19T07:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byDay: [1], until: null },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const s = await series(id);
    expect(s.start.toDate().toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(s.end.toDate().toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('a title-only edit from a later occurrence leaves the start untouched', async () => {
    const id = await createSeries();
    const res = await manage({
      action: 'update', id, scope: 'all', occurrenceStart: OCC_19,
      title: 'Mathematics', start: OCC_19, end: '2026-10-19T06:00:00.000Z',
    });
    expect(res.status).toBe(200);
    const s = await series(id);
    expect(s.title).toBe('Mathematics');
    expect(s.start.toDate().toISOString()).toBe(SERIES_START);
    expect(s.end.toDate().toISOString()).toBe(SERIES_END);
  });

  it('lengthening the class from any occurrence lengthens every one', async () => {
    const id = await createSeries();
    await manage({
      action: 'update', id, scope: 'all', occurrenceStart: OCC_19,
      start: OCC_19, end: '2026-10-19T06:30:00.000Z',
    });
    const s = await series(id);
    expect(s.start.toDate().toISOString()).toBe(SERIES_START);
    expect(s.end.toDate().toISOString()).toBe('2026-10-05T06:30:00.000Z');
  });

  it('a one-off event still takes the new start directly', async () => {
    const res = await manage({ action: 'create', title: 'Exam', start: SERIES_START, end: SERIES_END });
    await manage({ action: 'update', id: res.body.id, scope: 'all', occurrenceStart: SERIES_START, start: '2026-10-06T05:00:00.000Z', end: '2026-10-06T06:00:00.000Z' });
    const s = await series(res.body.id);
    expect(s.start.toDate().toISOString()).toBe('2026-10-06T05:00:00.000Z');
  });
});
