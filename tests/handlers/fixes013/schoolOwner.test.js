import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, setFlags, seedPlan,
} from '../_worker.js';

/**
 * 013Fixes / 01 — the school owner (subscription/current.ownerUid) and the
 * developer login (config/platform.devLoginEmail), both set by the superadmin.
 * New logins get no plan claim: the plan is the school's (013Fixes / 00).
 *
 * The developer address here is a placeholder; the real one is a production
 * setting, never in code or tests.
 */

const DEV = 'developer@platform.example';
let db;
let admin;
let teacherA;
let teacherB;

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  admin = await userWithClaims('fx013o-admin', teacherClaims.superadmin, { email: 'admin@platform.example' });
  teacherA = await userWithClaims('fx013o-a', { role: 'teacher' }, { email: 'a.teacher@school.example' });
  teacherB = await userWithClaims('fx013o-b', { role: 'teacher' }, { email: 'b.teacher@school.example' });
  await userWithClaims('fx013o-dev', { role: 'teacher' }, { email: DEV });
});

beforeEach(async () => {
  await clearFirestore();
  await seedPlan(db, 'gold');
  await setFlags(db, { 'fees.enabled': true });
});

const users = (token, body) => call('/api/admin/users', { token, body });
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).docs.map((d) => d.data());

describe('setOwner', () => {
  it('only the superadmin may set the owner', async () => {
    const res = await users(teacherA, { action: 'setOwner', uid: 'fx013o-a' });
    expect(res.status).toBe(403);
    expect((await db.doc('subscription/current').get()).data().ownerUid).toBeUndefined();
  });

  it('sets the owner, audited, and moving it replaces it', async () => {
    const first = await users(admin, { action: 'setOwner', uid: 'fx013o-a' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ ownerUid: 'fx013o-a', previousOwnerUid: null });
    expect((await db.doc('subscription/current').get()).data()).toMatchObject({ ownerUid: 'fx013o-a', tier: 'gold' });

    const moved = await users(admin, { action: 'setOwner', uid: 'fx013o-b' });
    expect(moved.body).toMatchObject({ ownerUid: 'fx013o-b', previousOwnerUid: 'fx013o-a' });
    expect((await db.doc('subscription/current').get()).data().ownerUid).toBe('fx013o-b');

    const entries = await audits('billing.owner_set');
    expect(entries.map((e) => [e.before.ownerUid, e.after.ownerUid])).toEqual(
      expect.arrayContaining([[null, 'fx013o-a'], ['fx013o-a', 'fx013o-b']])
    );
  });

  it('refuses a login that is not a teacher, a disabled login and an unknown one', async () => {
    expect((await users(admin, { action: 'setOwner', uid: 'fx013o-admin' })).body.error.code).toBe('not_teacher');
    await users(admin, { action: 'disable', uid: 'fx013o-b' });
    expect((await users(admin, { action: 'setOwner', uid: 'fx013o-b' })).body.error.code).toBe('disabled');
    await users(admin, { action: 'enable', uid: 'fx013o-b' });
    expect((await users(admin, { action: 'setOwner', uid: 'nobody-here' })).status).toBe(404);
  });

  it('the list marks the owner', async () => {
    await users(admin, { action: 'setOwner', uid: 'fx013o-a' });
    const list = await users(admin, { action: 'list' });
    expect(list.body.ownerUid).toBe('fx013o-a');
    const byUid = Object.fromEntries(list.body.users.map((u) => [u.uid, u]));
    expect(byUid['fx013o-a'].isOwner).toBe(true);
    expect(byUid['fx013o-b'].isOwner).toBe(false);
  });
});

describe('setDevLogin', () => {
  it('only the superadmin may set it', async () => {
    expect((await users(teacherA, { action: 'setDevLogin', devLoginEmail: DEV })).status).toBe(403);
  });

  it('stores it lower-case, marks that login in the list, and the audit never holds the whole address', async () => {
    const res = await users(admin, { action: 'setDevLogin', devLoginEmail: 'Developer@Platform.example' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.doc('config/platform').get()).data()).toMatchObject({ devLoginEmail: DEV, updatedBy: 'fx013o-admin' });

    const list = await users(admin, { action: 'list' });
    expect(list.body.devLoginEmail).toBe(DEV);
    const dev = list.body.users.find((u) => u.uid === 'fx013o-dev');
    expect(dev.isDeveloper).toBe(true);
    expect(list.body.users.filter((u) => u.isDeveloper)).toHaveLength(1);

    const [entry] = await audits('platform.dev_login_set');
    expect(entry.after.devLoginEmail).toBe('d***@platform.example');
    expect(JSON.stringify(entry)).not.toContain(DEV);
  });

  it('is changeable and clearable; an invalid email is refused', async () => {
    await users(admin, { action: 'setDevLogin', devLoginEmail: DEV });
    expect((await users(admin, { action: 'setDevLogin', devLoginEmail: 'not an email' })).status).toBe(400);
    await users(admin, { action: 'setDevLogin', devLoginEmail: 'b.teacher@school.example' });
    let list = await users(admin, { action: 'list' });
    expect(list.body.users.find((u) => u.uid === 'fx013o-b').isDeveloper).toBe(true);
    expect(list.body.users.find((u) => u.uid === 'fx013o-dev').isDeveloper).toBe(false);

    await users(admin, { action: 'setDevLogin', devLoginEmail: null });
    list = await users(admin, { action: 'list' });
    expect(list.body.devLoginEmail).toBeNull();
    expect(list.body.users.some((u) => u.isDeveloper)).toBe(false);
  });
});

describe('createTeacher', () => {
  it('a new login has no plan claim and still gets the school\'s plan', async () => {
    const res = await users(admin, {
      action: 'createTeacher', email: 'new.teacher@school.example', password: 'a-long-password-123', displayName: 'New',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const authRest = await import('../../../api/_lib/authRest.js');
    const created = await authRest.getUser(res.body.uid);
    expect(created.customClaims).toEqual({ role: 'teacher' });

    const token = await (async () => {
      const r = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new.teacher@school.example', password: 'a-long-password-123', returnSecureToken: true }),
      });
      return (await r.json()).idToken;
    })();
    expect((await call('/api/fees/config', { method: 'GET', token })).status).toBe(200); // Gold school
    await authRest.deleteUser(res.body.uid);
  });
});
