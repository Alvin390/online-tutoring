import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb,
  clearFirestore, setFlags, phoneN,
} from '../_worker.js';

/**
 * Phase 13 / 02 — sessions and class links.
 *
 * Ports validation checks B1, B2, B5 and I1 (server side) so they assert the
 * FIX, plus the new behaviour: default sessions without a script, one link
 * store, session validation instead of a hard-coded list, and full session
 * details (description + schedule).
 */

let db;
let gold;
let FieldValue;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  ({ FieldValue } = await import('../../../api/_lib/firebaseAdmin.js'));
  gold = await userWithClaims('p13-sessions-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  const sessions = await import('../../../api/_lib/sessions.js');
  sessions.__resetSessionCache();
});

async function seedStudent(session, phone, extra = {}) {
  await db.doc(`sessions/${session}/students/${phone}`).set({
    studentName: 'Session Test', parentPhone: phone, class: 'Grade 8', subjects: 'Maths',
    receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date('2026-01-10T08:00:00Z'),
    session, blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
describe('D1 ensureDefaultSessions', () => {
  it('creates morning and evening pre-filled with today\'s homepage details', async () => {
    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    const result = await ensureDefaultSessions(db, { actor: 'test' });
    expect(result.ran).toBe(true);

    const morning = (await db.doc('sessions/morning').get()).data();
    const evening = (await db.doc('sessions/evening').get()).data();

    expect(morning).toMatchObject({
      name: 'Morning Session', slug: 'morning', active: true, order: 0, icon: 'bi-sunrise-fill',
      description: 'Start your day with focused learning and interactive classes',
      schedule: { days: [], startTime: '08:00', endTime: '12:00', tz: 'Africa/Nairobi' },
    });
    expect(evening).toMatchObject({
      name: 'Evening Session', slug: 'evening', active: true, order: 1, icon: 'bi-moon-stars-fill',
      description: 'Perfect for after-school learning and homework support',
      schedule: { days: [], startTime: '16:00', endTime: '20:00', tz: 'Africa/Nairobi' },
    });
    expect((await db.doc('config/sessionsBootstrap').get()).exists).toBe(true);
  });

  it('is idempotent under concurrency: one set of documents, one audit entry', async () => {
    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    const runs = await Promise.all([1, 2, 3].map(() => ensureDefaultSessions(db, { actor: 'test' })));
    expect(runs.filter((r) => r.ran)).toHaveLength(1);
    const audits = await db.collection('audit').where('action', '==', 'sessions.bootstrapped').get();
    expect(audits.size).toBe(1);
    expect((await db.collection('sessions').get()).size).toBe(2);
  });

  it('never resurrects a default session the teacher deleted', async () => {
    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    await ensureDefaultSessions(db, { actor: 'test' });
    await db.doc('sessions/evening').delete();
    const again = await ensureDefaultSessions(db, { actor: 'test' });
    expect(again.ran).toBe(false);
    expect((await db.doc('sessions/evening').get()).exists).toBe(false);
  });

  it('copies valid legacy links into missing private docs, never overwriting, skipping invalid', async () => {
    await db.doc('config/zoomLinks').set({
      morning: 'https://zoom.us/j/1111111111',
      evening: 'http://not-https.example/x',
    });
    await db.doc('sessions/morning/private/classLink').set({ url: 'https://zoom.us/j/5555555555', provider: 'zoom' });

    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    const result = await ensureDefaultSessions(db, { actor: 'test' });

    expect((await db.doc('sessions/morning/private/classLink').get()).data().url).toBe('https://zoom.us/j/5555555555');
    expect((await db.doc('sessions/evening/private/classLink').get()).exists).toBe(false);
    expect(result.skippedInvalidLinks).toEqual(['evening']);
  });

  it('migrates a legacy link when no private doc exists', async () => {
    await db.doc('config/zoomLinks').set({ evening: 'https://meet.google.com/abc-defg-hij' });
    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    await ensureDefaultSessions(db, { actor: 'test' });
    const link = (await db.doc('sessions/evening/private/classLink').get()).data();
    expect(link).toMatchObject({ url: 'https://meet.google.com/abc-defg-hij', provider: 'meet' });
  });

  it('runs from the dashboard via sessions/manage bootstrap (teacher only)', async () => {
    const anon = await call('/api/sessions/manage', { body: { action: 'bootstrap' } });
    expect(anon.status).toBe(401);
    const res = await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
    expect(res.status).toBe(200);
    expect(res.body.ran).toBe(true);
    expect((await db.doc('sessions/morning').get()).exists).toBe(true);
  });

  it('runs from the hourly subscription sweep', async () => {
    const res = await call('/api/cron/subscriptionSweep', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, body: {},
    });
    expect(res.status).toBe(200);
    expect((await db.doc('sessions/evening').get()).exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('B2 seed:sessions', () => {
  it('exits 0 against the emulator and seeds both sessions with their links', async () => {
    await db.doc('config/zoomLinks').set({
      morning: 'https://zoom.us/j/1111111111', evening: 'https://zoom.us/j/2222222222',
    });
    const run = spawnSync(process.execPath, ['scripts/seedSessions.js'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, FIREBASE_SERVICE_ACCOUNT: 'emulator-dummy-not-a-credential' },
    });
    expect(run.status, run.stderr).toBe(0);
    for (const s of ['morning', 'evening']) {
      expect((await db.doc(`sessions/${s}`).get()).exists).toBe(true);
      expect((await db.doc(`sessions/${s}/private/classLink`).get()).exists).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('D2 count() in the REST shim', () => {
  it('matches firebase-admin on empty, filtered and limited queries', async () => {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT });
    const admin = getFirestore(app);

    for (let i = 0; i < 7; i += 1) {
      await db.doc(`countTest/items/rows/r${i}`).set({ even: i % 2 === 0, n: i });
    }
    const cases = [
      (d) => d.collection('countTest/items/empty'),
      (d) => d.collection('countTest/items/rows'),
      (d) => d.collection('countTest/items/rows').where('even', '==', true),
      (d) => d.collection('countTest/items/rows').limit(3),
    ];
    for (const build of cases) {
      const rest = (await build(db).count().get()).data().count;
      const ref = (await build(admin).count().get()).data().count;
      expect(rest).toBe(ref);
    }
  });
});

// ---------------------------------------------------------------------------
describe('D3 one link store (B1)', () => {
  it('the dashboard save is what students receive, even after a seed', async () => {
    const { ensureDefaultSessions } = await import('../../../api/_lib/sessions.js');
    await db.doc('config/zoomLinks').set({ morning: 'https://zoom.us/j/1111111111' });
    await ensureDefaultSessions(db, { actor: 'test' });

    const save = await call('/api/class/setLink', { token: gold, body: { session: 'morning', url: 'https://zoom.us/j/9999999999' } });
    expect(save.status).toBe(200);

    const issued = await call('/api/class/link', { token: gold, body: { session: 'morning', phone: phoneN(1) } });
    expect(issued.body.url).toBe('https://zoom.us/j/9999999999');

    const priv = (await db.doc('sessions/morning/private/classLink').get()).data();
    expect(priv.url).toBe('https://zoom.us/j/9999999999');
    // class/setLink no longer writes the legacy store.
    expect((await db.doc('config/zoomLinks').get()).data().morning).toBe('https://zoom.us/j/1111111111');
  });

  it('sessions/manage setLink and class/setLink write the same document', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
    await call('/api/sessions/manage', { token: gold, body: { action: 'setLink', slug: 'evening', url: 'https://zoom.us/j/3333333333' } });
    const a = (await db.doc('sessions/evening/private/classLink').get()).data().url;
    await call('/api/class/setLink', { token: gold, body: { session: 'evening', url: 'https://zoom.us/j/4444444444' } });
    const b = (await db.doc('sessions/evening/private/classLink').get()).data().url;
    expect([a, b]).toEqual(['https://zoom.us/j/3333333333', 'https://zoom.us/j/4444444444']);
  });

  it('falls back to config/zoomLinks only when the private doc is missing', async () => {
    await db.doc('config/zoomLinks').set({ morning: 'https://zoom.us/j/7777777777' });
    const legacy = await call('/api/class/link', { token: gold, body: { session: 'morning', phone: phoneN(2) } });
    expect(legacy.body.url).toBe('https://zoom.us/j/7777777777');
  });

  it('refuses a link for a session that does not exist', async () => {
    const res = await call('/api/class/setLink', { token: gold, body: { session: 'ghost', url: 'https://zoom.us/j/1234567890' } });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('D6 session validation (B5)', () => {
  it('a teacher-created session works end to end', async () => {
    const created = await call('/api/sessions/manage', { token: gold, body: { action: 'create', slug: 'weekend', name: 'Weekend Class' } });
    expect(created.status).toBe(200);

    const link = await call('/api/class/setLink', { token: gold, body: { session: 'weekend', url: 'https://zoom.us/j/3131313131' } });
    expect(link.status).toBe(200);

    await seedStudent('weekend', phoneN(50));
    const checkin = await call('/api/student/checkin', { body: { session: 'weekend', phone: phoneN(50) } });
    expect(checkin.status).toBe(200);
    expect(checkin.body.exists).toBe(true);

    const issued = await call('/api/class/link', { body: { session: 'weekend', phone: phoneN(50) } });
    expect(issued.status).toBe(200);
    expect(issued.body.url).toBe('https://zoom.us/j/3131313131');
  });

  it('a nonexistent session is 404 and a reserved slug is 400', async () => {
    const missing = await call('/api/student/checkin', { body: { session: 'nowhere', phone: phoneN(51) } });
    expect(missing.status).toBe(404);
    const reserved = await call('/api/student/checkin', { body: { session: 'dashboard', phone: phoneN(51) } });
    expect(reserved.status).toBe(400);
  });

  it('an inactive session is closed to students but open to the teacher', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'create', slug: 'paused', name: 'Paused', active: false } });
    await seedStudent('paused', phoneN(52));

    const student = await call('/api/student/checkin', { body: { session: 'paused', phone: phoneN(52) } });
    expect(student.status).toBe(404);

    const teacher = await call('/api/fees/summary', { token: gold, body: { session: 'paused', phone: phoneN(52) } });
    expect(teacher.status).not.toBe(404);
  });

  it('transitional: morning works before its session document exists', async () => {
    await seedStudent('morning', phoneN(53));
    const res = await call('/api/student/checkin', { body: { session: 'morning', phone: phoneN(53) } });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
  });

  it('every handler that takes a session declares the right policy', async () => {
    const expected = {
      'student/checkin': 'active', 'class/link': 'any', 'student/receipt': 'active',
      'student/resubmit': 'active', 'student/requestCode': 'active', 'student/verifyCode': 'active',
      'payments/initiate': 'active', 'fees/summary': 'any', 'calendar/events': 'any',
      'calendar/feedToken': 'any', 'calendar/manage': 'any', 'class/setLink': 'any',
      'fees/approveReceipt': 'any', 'fees/generateInvoices': 'any', 'fees/post': 'any',
      'student/approve': 'any', 'student/remove': 'any', 'whatsapp/campaign': 'any',
    };
    expect(Object.keys(expected)).toHaveLength(18);
    for (const [path, policy] of Object.entries(expected)) {
      const url = pathToFileURL(resolvePath(process.cwd(), 'api', `${path}.js`)).href;
      const mod = await import(/* @vite-ignore */ url);
      expect(mod.default.sessionPolicy, path).toBe(policy);
    }
  });
});

// ---------------------------------------------------------------------------
describe('D8 session details', () => {
  beforeEach(async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
  });

  it('updates every homepage field of a default session', async () => {
    const res = await call('/api/sessions/manage', {
      token: gold,
      body: {
        action: 'update', slug: 'morning', name: 'Early Birds',
        description: 'Fresh minds, first thing.',
        schedule: { days: [1, 3, 5], startTime: '07:30', endTime: '10:00' },
        icon: 'bi-sun-fill', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', active: true,
      },
    });
    expect(res.status).toBe(200);
    const doc = (await db.doc('sessions/morning').get()).data();
    expect(doc).toMatchObject({
      name: 'Early Birds', slug: 'morning', description: 'Fresh minds, first thing.',
      schedule: { days: [1, 3, 5], startTime: '07:30', endTime: '10:00', tz: 'Africa/Nairobi' },
      icon: 'bi-sun-fill',
    });
    const audit = await db.collection('audit').where('action', '==', 'session.updated').get();
    expect(audit.docs[0].data().after.changed).toEqual(expect.arrayContaining(['name', 'description', 'schedule', 'icon', 'gradient']));
  });

  it('rejects an end time before the start, a long description, duplicate days and unknown keys', async () => {
    const bad = [
      { schedule: { days: [], startTime: '12:00', endTime: '08:00' } },
      { description: 'x'.repeat(161) },
      { schedule: { days: [1, 1], startTime: '08:00', endTime: '09:00' } },
      { colour: 'red' },
    ];
    for (const patch of bad) {
      const res = await call('/api/sessions/manage', { token: gold, body: { action: 'update', slug: 'evening', ...patch } });
      expect(res.status, JSON.stringify(patch)).toBe(400);
    }
  });

  it('accepts times without days, and clearing the schedule', async () => {
    const a = await call('/api/sessions/manage', { token: gold, body: { action: 'update', slug: 'evening', schedule: { days: [], startTime: '17:00', endTime: '19:00' } } });
    expect(a.status).toBe(200);
    const b = await call('/api/sessions/manage', { token: gold, body: { action: 'update', slug: 'evening', schedule: null } });
    expect(b.status).toBe(200);
    expect((await db.doc('sessions/evening').get()).data().schedule).toBeNull();
  });

  it('a renamed default keeps its registration URL', async () => {
    await call('/api/sessions/manage', { token: gold, body: { action: 'update', slug: 'morning', name: 'Early Birds' } });
    await seedStudent('morning', phoneN(60));
    const res = await call('/api/student/checkin', { body: { session: 'morning', phone: phoneN(60) } });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
  });

  it('create accepts description and schedule', async () => {
    const res = await call('/api/sessions/manage', {
      token: gold,
      body: { action: 'create', slug: 'saturday', name: 'Saturday Revision', description: 'Exam prep.', schedule: { days: [6], startTime: '09:00', endTime: '12:00' } },
    });
    expect(res.status).toBe(200);
    expect((await db.doc('sessions/saturday').get()).data()).toMatchObject({ description: 'Exam prep.', schedule: { days: [6] } });
  });
});

// Keep the FieldValue import used (some helpers above may need it later).
void FieldValue;
void setFlags;

// ---------------------------------------------------------------------------
// The registration form's class dropdown is per session and edited by the
// teacher (sessions/manage `classes`); registration only accepts a listed class.
describe('session class lists', () => {
  const manage = (body) => call('/api/sessions/manage', { token: gold, body });
  const DEFAULTS = ['Form One', 'Form Two', 'Form Three', 'Form Four'];
  const register = (session, phone, cls) => call('/api/student/register', {
    body: { session, phone, studentName: 'Amina Wanjiru', class: cls, subjects: 'Mathematics', receiptMessage: 'QAB123XYZ9 Confirmed' },
  });

  it('a new session starts with the default classes', async () => {
    expect((await manage({ action: 'create', slug: 'saturday', name: 'Saturday Class' })).status).toBe(200);
    expect((await getTestDb()).doc('sessions/saturday')).toBeTruthy();
    const doc = (await (await getTestDb()).doc('sessions/saturday').get()).data();
    expect(doc.classes).toEqual(DEFAULTS);
  });

  it('the teacher replaces the list; spaces are tidied; the change is audited', async () => {
    await manage({ action: 'create', slug: 'saturday', name: 'Saturday Class' });
    const res = await manage({ action: 'update', slug: 'saturday', classes: ['Grade 7', ' Grade  8 ', 'Grade 9'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changed).toContain('classes');
    const db = await getTestDb();
    expect((await db.doc('sessions/saturday').get()).data().classes).toEqual(['Grade 7', 'Grade 8', 'Grade 9']);
    const audits = await db.collection('audit').where('action', '==', 'session.updated').get();
    expect(audits.docs.some((d) => (d.data().after?.changed ?? []).includes('classes'))).toBe(true);
  });

  for (const [label, classes] of [
    ['an empty list', []],
    ['a blank entry', ['Grade 7', '  ']],
    ['a duplicate (case-insensitive)', ['Grade 7', 'grade 7']],
    ['more than 30', Array.from({ length: 31 }, (_, i) => `Class ${i + 1}`)],
    ['a 61-character name', ['x'.repeat(61)]],
  ]) {
    it(`refuses ${label}`, async () => {
      await manage({ action: 'create', slug: 'saturday', name: 'Saturday Class' });
      expect((await manage({ action: 'update', slug: 'saturday', classes })).status).toBe(400);
    });
  }

  it('the public bootstrap carries each session\'s list (defaults where none is set)', async () => {
    await manage({ action: 'create', slug: 'saturday', name: 'Saturday Class' });
    await manage({ action: 'update', slug: 'saturday', classes: ['Grade 7', 'Grade 8'] });
    const db = await getTestDb();
    await db.doc('sessions/legacy').set({ slug: 'legacy', name: 'Legacy', active: true, order: 5 });
    (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
    const res = await call('/api/public/bootstrap', { method: 'GET' });
    const bySlug = Object.fromEntries(res.body.sessions.map((x) => [x.slug, x.classes]));
    expect(bySlug.saturday).toEqual(['Grade 7', 'Grade 8']);
    expect(bySlug.legacy).toEqual(DEFAULTS);
  });

  it('registration accepts a class from the session\'s list and refuses one that is not on it', async () => {
    await manage({ action: 'create', slug: 'saturday', name: 'Saturday Class' });
    await manage({ action: 'update', slug: 'saturday', classes: ['Grade 7', 'Grade 8'] });
    const wrong = await register('saturday', phoneN(70), 'Form One');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('invalid_class');
    const ok = await register('saturday', phoneN(71), 'Grade 8');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.student.class).toBe('Grade 8');
  });
});
