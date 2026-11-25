import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, resetFakes, externalCalls,
} from '../_worker.js';

/**
 * 013Fixes / 29 — the school's own M-Pesa (Daraja) keys, stored encrypted
 * (owner answer 5, round 3): write-only (only the last 4 characters come
 * back), audited without values, used in LIVE mode before the environment's
 * (which stays the fallback, so today's setup keeps working); sandbox keeps
 * the environment's sandbox keys. Nothing ever logged.
 */

// Placeholder values only (public repo).
const KEYS = {
  consumerKey: 'CK-placeholder-AAAA1111',
  consumerSecret: 'CS-placeholder-BBBB2222',
  passkey: 'PK-placeholder-CCCC3333',
  shortCode: '600999',
  shortCodeType: 'till',
};

let db; let admin; let teacher; let logs;
const LIVE_ENV = ['DARAJA_MODE', 'DARAJA_LIVE_CONSUMER_KEY', 'DARAJA_LIVE_CONSUMER_SECRET', 'DARAJA_LIVE_PASSKEY', 'DARAJA_LIVE_SHORTCODE', 'DARAJA_LIVE_SHORTCODE_TYPE'];
const saved = {};

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013-daraja-admin', teacherClaims.superadmin);
  teacher = await userWithClaims('fx013-daraja-teacher', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  resetFakes();
  for (const k of LIVE_ENV) saved[k] = process.env[k];
  (await import('../../../api/_lib/darajaKeys.js')).__resetDarajaKeys();
  (await import('../../../api/_lib/daraja.js'))._resetTokenCache();
  logs = [];
  for (const level of ['log', 'warn', 'error']) vi.spyOn(console, level).mockImplementation((line) => { logs.push(String(line)); });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.restoreAllMocks();
});

const daraja = (body, token = admin) => call('/api/admin/daraja', { token, body });
const live = () => { process.env.DARAJA_MODE = 'live'; };
const leaks = (text) => [KEYS.consumerKey, KEYS.consumerSecret, KEYS.passkey].some((v) => text.includes(v));

describe('saving the keys', () => {
  it('write-only: the reply carries the last 4 characters and when, never a value; audited without values', async () => {
    const res = await daraja({ action: 'save', ...KEYS });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.keys).toMatchObject({
      saved: true, shortCodeType: 'till',
      last4: { consumerKey: '1111', consumerSecret: '2222', passkey: '3333', shortCode: '0999' },
    });
    expect(typeof res.body.keys.savedAt).toBe('number');
    expect(leaks(JSON.stringify(res.body))).toBe(false);
    const status = await daraja({ action: 'status' });
    expect(leaks(JSON.stringify(status.body))).toBe(false);
    expect(status.body.keys.last4.passkey).toBe('3333');
    const [audit] = (await db.collection('audit').where('action', '==', 'mpesa.keys_saved').get()).docs.map((d) => d.data());
    expect(audit).toBeTruthy();
    expect(leaks(JSON.stringify(audit))).toBe(false);
    expect(leaks(logs.join('\n'))).toBe(false);
  });

  it('encrypted at rest: the stored document holds no plain value', async () => {
    await daraja({ action: 'save', ...KEYS });
    const raw = JSON.stringify((await db.doc('config/darajaCredentials').get()).data());
    expect(leaks(raw)).toBe(false);
    expect(raw).not.toContain(KEYS.shortCode);
    const { decrypt } = await import('../../../api/_lib/crypto.js');
    expect(decrypt((await db.doc('config/darajaCredentials').get()).data().live.consumerKey)).toBe(KEYS.consumerKey);
  });

  it('checked: the shortcode is digits, the type is till or paybill, every key present', async () => {
    for (const bad of [{ shortCode: '60A999' }, { shortCodeType: 'bank' }, { passkey: '' }, { consumerKey: undefined }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await daraja({ action: 'save', ...KEYS, ...bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await db.doc('config/darajaCredentials').get()).exists).toBe(false);
  });

  it('superadmin only', async () => {
    expect((await daraja({ action: 'status' }, teacher)).status).toBe(403);
    expect((await daraja({ action: 'save', ...KEYS }, teacher)).status).toBe(403);
    expect((await daraja({ action: 'clear' }, teacher)).status).toBe(403);
  });
});

describe('which keys M-Pesa uses', () => {
  it('live mode: the saved keys, before the environment\'s; the M-Pesa sign-in uses them', async () => {
    live();
    Object.assign(process.env, { DARAJA_LIVE_CONSUMER_KEY: 'env-ck', DARAJA_LIVE_CONSUMER_SECRET: 'env-cs', DARAJA_LIVE_PASSKEY: 'env-pk', DARAJA_LIVE_SHORTCODE: '111111', DARAJA_LIVE_SHORTCODE_TYPE: 'paybill' });
    const { loadCredentials, getAccessToken } = await import('../../../api/_lib/daraja.js');
    expect((await loadCredentials()).source).toBe('env');
    await daraja({ action: 'save', ...KEYS });
    const creds = await loadCredentials();
    expect(creds).toMatchObject({ source: 'stored', consumerKey: KEYS.consumerKey, shortCode: KEYS.shortCode, shortCodeType: 'till', environment: 'production' });
    await getAccessToken(creds);
    const oauth = externalCalls.filter((c) => String(c.url).includes('/oauth/')).pop();
    expect(oauth.headers?.authorization ?? oauth.headers?.Authorization).toBe(`Basic ${Buffer.from(`${KEYS.consumerKey}:${KEYS.consumerSecret}`).toString('base64')}`);
  });

  it('sandbox mode: the environment\'s sandbox keys, even with keys saved', async () => {
    await daraja({ action: 'save', ...KEYS });
    const { loadCredentials } = await import('../../../api/_lib/daraja.js');
    expect(await loadCredentials()).toMatchObject({ source: 'env', environment: 'sandbox', shortCode: '174379' });
  });

  it('cleared: back to the environment (or not set up at all)', async () => {
    live();
    // No server live keys either (the harness has placeholder ones; afterEach restores them).
    for (const k of ['DARAJA_LIVE_CONSUMER_KEY', 'DARAJA_LIVE_CONSUMER_SECRET', 'DARAJA_LIVE_PASSKEY', 'DARAJA_LIVE_SHORTCODE', 'DARAJA_LIVE_SHORTCODE_TYPE']) delete process.env[k];
    await daraja({ action: 'save', ...KEYS });
    const res = await daraja({ action: 'clear' });
    expect(res.status).toBe(200);
    expect(res.body.keys).toMatchObject({ saved: false });
    expect((await db.doc('config/darajaCredentials').get()).data()?.live ?? null).toBeNull();
    const { loadCredentials } = await import('../../../api/_lib/daraja.js');
    await expect(loadCredentials()).rejects.toMatchObject({ code: 'daraja_not_configured' });
    expect((await db.collection('audit').where('action', '==', 'mpesa.keys_cleared').get()).size).toBe(1);
  });
});

describe('the old diagnostics endpoint', () => {
  it('its save points to the new card', async () => {
    const res = await call('/api/daraja/credentials', { token: admin, body: { action: 'save' } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Superadmin.*M-Pesa/);
  });
});
