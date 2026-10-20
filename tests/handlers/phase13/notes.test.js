import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, getTestDb, clearFirestore, setFlags,
} from '../_worker.js';

/**
 * Phase 13 / 07 D4 — notes soft-deleted more than 30 days ago are really
 * purged by the nightly sweep; anything inside the window is kept.
 */

let db;
const CRON = { authorization: 'Bearer test-cron-secret' };
const DAY = 24 * 60 * 60 * 1000;
const notePath = (phone, id) => `sessions/morning/students/${phone}/notes/${id}`;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
});

beforeEach(async () => {
  await clearFirestore();
  await db.doc('sessions/morning').set({ slug: 'morning', name: 'Morning', active: true });
  await db.doc(notePath('+254711000001', 'old')).set({ body: 'old', deletedAt: new Date(Date.now() - 31 * DAY) });
  await db.doc(notePath('+254711000002', 'recent')).set({ body: 'recent', deletedAt: new Date(Date.now() - 29 * DAY) });
  await db.doc(notePath('+254711000002', 'live')).set({ body: 'live', deletedAt: null });
});

const exists = async (phone, id) => (await db.doc(notePath(phone, id)).get()).exists;

describe('deleted-notes purge (feesSweep)', () => {
  it('deletes a 31-day-old soft-deleted note and keeps a 29-day-old one and live notes', async () => {
    await setFlags(db, { 'fees.enabled': true });
    const res = await call('/api/cron/feesSweep', { headers: CRON });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.notesPurged).toBe(1);
    expect(await exists('+254711000001', 'old')).toBe(false);
    expect(await exists('+254711000002', 'recent')).toBe(true);
    expect(await exists('+254711000002', 'live')).toBe(true);
  });

  it('runs even when fees are switched off', async () => {
    await setFlags(db, { 'fees.enabled': false });
    const res = await call('/api/cron/feesSweep', { headers: CRON });
    expect(res.body).toMatchObject({ skipped: 'fees_disabled', notesPurged: 1 });
    expect(await exists('+254711000001', 'old')).toBe(false);
  });
});
