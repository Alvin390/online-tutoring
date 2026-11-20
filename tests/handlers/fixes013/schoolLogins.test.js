import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore, seedPlan, AUTH_HOST,
} from '../_worker.js';

/**
 * 013Fixes / 09 — the school owner manages the school's logins, up to a hard
 * limit (the plan's included logins + extra ones the superadmin adds by hand).
 * Disabling or removing a login frees its seat; the developer login never
 * takes one; after a downgrade existing logins keep working but none can be
 * added. Every change is audited.
 */

let db;
let owner;
let other;
let admin;
let seq = 0;

const fresh = () => `fx013l-${Date.now().toString(36)}-${(seq += 1)}@school.example`;
const signIn = async (email, password) => {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return (await r.json()).idToken ?? null;
};

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  owner = await userWithClaims('fx013l-owner', { role: 'teacher' }, { email: 'owner@fx013l.example' });
  other = await userWithClaims('fx013l-other', { role: 'teacher' }, { email: 'other@fx013l.example' });
  await userWithClaims('fx013l-dev', { role: 'teacher' }, { email: 'dev@fx013l.example' });
  admin = await userWithClaims('fx013l-admin', teacherClaims.superadmin);
});

beforeEach(async () => {
  await clearFirestore();
  await seedPlan(db, 'bronze', { ownerUid: 'fx013l-owner' }); // Bronze: 2 logins
  await db.doc('users/fx013l-owner').set({ role: 'teacher' });
  await db.doc('users/fx013l-other').set({ role: 'teacher' });
  // Re-enable between tests (Auth isn't cleared with Firestore).
  const authRest = await import('../../../api/_lib/authRest.js');
  for (const uid of ['fx013l-owner', 'fx013l-other', 'fx013l-dev']) await authRest.updateUser(uid, { disabled: false });
});

const logins = (body, token = owner) => call('/api/school/logins', { token, body });
const add = (token = owner) => logins({ action: 'add', email: fresh(), password: 'a-long-password-123', displayName: 'New' }, token);
const audits = async (action) => (await db.collection('audit').where('action', '==', action).get()).size;

describe('only the owner (or the superadmin)', () => {
  it('another teacher is refused; the owner and the superadmin list', async () => {
    expect((await logins({ action: 'list' }, other)).body.error.code).toBe('not_owner');
    const res = await logins({ action: 'list' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.seats).toEqual({ used: 2, included: 2, extra: 0, limit: 2 });
    expect(res.body.logins.find((l) => l.uid === 'fx013l-owner').isOwner).toBe(true);
    expect((await logins({ action: 'list' }, admin)).status).toBe(200);
  });

  it('nobody but the superadmin while no owner is set', async () => {
    await db.doc('subscription/current').set({ ownerUid: null }, { merge: true });
    expect((await logins({ action: 'list' })).status).toBe(403);
    expect((await logins({ action: 'list' }, admin)).status).toBe(200);
  });

  it('a crafted role in the request is refused (strict)', async () => {
    const res = await logins({ action: 'add', email: fresh(), password: 'a-long-password-123', role: 'superadmin' });
    expect(res.status).toBe(400);
  });
});

describe('the hard limit', () => {
  it('Bronze with 2 logins in use: adding is refused', async () => {
    const res = await add();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('seat_limit');
    expect(res.body.error.message).toMatch(/includes 2 logins/);
  });

  it('disabling frees a seat; the new login gets the school plan and no plan claim; re-enabling at the limit is refused', async () => {
    const off = await logins({ action: 'disable', uid: 'fx013l-other' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.seats.used).toBe(1);
    expect((await db.doc('users/fx013l-other').get()).data().disabled).toBe(true);

    const email = fresh();
    const made = await logins({ action: 'add', email, password: 'a-long-password-123' });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body.seats.used).toBe(2);
    const authRest = await import('../../../api/_lib/authRest.js');
    expect((await authRest.getUser(made.body.uid)).customClaims).toEqual({ role: 'teacher' });
    expect((await db.doc(`users/${made.body.uid}`).get()).data()).toMatchObject({ role: 'teacher', disabled: false });
    const token = await signIn(email, 'a-long-password-123');
    expect((await call('/api/billing/status', { method: 'GET', token })).body.plan.tier).toBe('bronze');

    const back = await logins({ action: 'enable', uid: 'fx013l-other' });
    expect(back.status).toBe(409);
    expect(await audits('school.login_added')).toBe(1);
    expect(await audits('school.login_disabled')).toBe(1);
  });

  it('extra logins from the superadmin raise the limit (audited)', async () => {
    expect((await call('/api/admin/users', { token: owner, body: { action: 'setExtraLogins', extraLogins: 1 } })).status).toBe(403);
    const set = await call('/api/admin/users', { token: admin, body: { action: 'setExtraLogins', extraLogins: 1 } });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(await audits('billing.extra_logins_set')).toBe(1);
    const res = await add();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.seats).toMatchObject({ used: 3, limit: 3, extra: 1 });
    expect((await add()).status).toBe(409);
  });

  it('after a downgrade, logins above the limit keep working; none can be added', async () => {
    await seedPlan(db, 'gold', { ownerUid: 'fx013l-owner' });
    const email = fresh();
    expect((await logins({ action: 'add', email, password: 'a-long-password-123' })).status).toBe(200);
    await seedPlan(db, 'bronze', { ownerUid: 'fx013l-owner' }); // 3 logins on a 2-login plan
    const token = await signIn(email, 'a-long-password-123');
    expect((await call('/api/billing/status', { method: 'GET', token })).status).toBe(200);
    expect((await add()).status).toBe(409);
  });
});

describe('protected logins', () => {
  it('the developer login takes no seat and can\'t be disabled or removed by the owner', async () => {
    await db.doc('users/fx013l-dev').set({ role: 'teacher' });
    await db.doc('config/platform').set({ devLoginEmail: 'dev@fx013l.example' });
    const list = await logins({ action: 'list' });
    expect(list.body.seats.used).toBe(2);
    expect(list.body.logins.find((l) => l.uid === 'fx013l-dev').isDeveloper).toBe(true);
    expect((await logins({ action: 'disable', uid: 'fx013l-dev' })).body.error.code).toBe('developer_login');
    expect((await logins({ action: 'remove', uid: 'fx013l-dev', confirmEmail: 'dev@fx013l.example' })).body.error.code).toBe('developer_login');
  });

  it('the owner can\'t disable or remove their own login', async () => {
    expect((await logins({ action: 'disable', uid: 'fx013l-owner' })).body.error.code).toBe('owner_login');
    expect((await logins({ action: 'remove', uid: 'fx013l-owner', confirmEmail: 'owner@fx013l.example' })).body.error.code).toBe('owner_login');
  });

  it('only the school\'s teacher logins can be targeted', async () => {
    expect((await logins({ action: 'disable', uid: 'fx013l-admin' })).status).toBe(404);
  });
});

describe('remove', () => {
  it('needs the email typed back; frees the seat; deletes the login and its users document', async () => {
    await seedPlan(db, 'silver', { ownerUid: 'fx013l-owner' });
    const email = fresh();
    const made = await logins({ action: 'add', email, password: 'a-long-password-123' });
    expect((await logins({ action: 'remove', uid: made.body.uid, confirmEmail: 'wrong@x.example' })).body.error.code).toBe('confirmation_mismatch');
    const gone = await logins({ action: 'remove', uid: made.body.uid, confirmEmail: email.toUpperCase() });
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(gone.body.seats.used).toBe(2);
    expect((await db.doc(`users/${made.body.uid}`).get()).exists).toBe(false);
    expect(await signIn(email, 'a-long-password-123')).toBeNull();
    expect(await audits('school.login_removed')).toBe(1);
  });
});

describe('the superadmin console keeps the seat count right', () => {
  it('disable and enable there also update users/{uid}.disabled; the list carries the seats', async () => {
    await call('/api/admin/users', { token: admin, body: { action: 'disable', uid: 'fx013l-other' } });
    expect((await db.doc('users/fx013l-other').get()).data().disabled).toBe(true);
    let list = await call('/api/admin/users', { token: admin, body: { action: 'list' } });
    expect(list.body.seats).toMatchObject({ used: 1, limit: 2 });
    await call('/api/admin/users', { token: admin, body: { action: 'enable', uid: 'fx013l-other' } });
    list = await call('/api/admin/users', { token: admin, body: { action: 'list' } });
    expect(list.body.seats.used).toBe(2);
  });
});
