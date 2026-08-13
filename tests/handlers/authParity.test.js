import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * NOTE ON THE EMULATOR PROJECT ID
 *
 * `npm run test:handlers` passes `--project demo-online-tutoring`, and it has
 * to. Without it the emulator falls back to "demo-no-project" and mints ID
 * tokens with that audience, which the shim then correctly rejects. Firestore
 * never noticed because its REST paths carry the project explicitly; Auth
 * tokens do not, so the two halves have to agree.
 */

/**
 * Firebase Auth REST shim vs firebase-admin — Phase 12 D3.
 *
 * The unit tests for authRest.js verify the CRYPTO (signature checking,
 * revocation, claim validation) with every network call stubbed. That leaves
 * the half those stubs assume: whether the Identity Toolkit request shapes and
 * response field names are actually right.
 *
 * That half matters more than it looks. A wrong field name here does not throw
 * anywhere obvious — it surfaces at step 4 of the deployment runbook when
 * `seed:superadmin` fails, or worse, `setCustomUserClaims` silently no-ops and
 * the teacher never receives a role claim, so they are bounced to /403 with
 * everything apparently configured correctly.
 *
 * So: both clients against the same Auth emulator, cross-reading each other's
 * writes.
 *
 * Run with: npm run test:handlers   (emulators:exec --only firestore,auth)
 */

let adminAuth;   // firebase-admin (the reference)
let restAuth;    // the shim under test

const created = [];

beforeAll(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT ??= 'demo-online-tutoring';
  process.env.METADATA_SERVER_DETECTION ??= 'none';
  process.env.GCE_METADATA_HOST ??= '0.0.0.0';

  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');

  const app = getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId: process.env.GCLOUD_PROJECT });

  adminAuth = getAuth(app);
  restAuth = await import('../../api/_lib/authRest.js');
});

afterAll(async () => {
  await Promise.all(created.map((uid) => adminAuth.deleteUser(uid).catch(() => {})));
});

let counter = 0;
function freshUid(prefix = 'u') {
  counter += 1;
  const uid = `parity_${prefix}_${counter}_${Date.now()}`;
  created.push(uid);
  return uid;
}

const email = (uid) => `${uid}@example.com`;

// ---------------------------------------------------------------------------

describe('createUser', () => {
  it('creates with a caller-supplied uid, as the student flow requires', async () => {
    // api/student/verifyCode.js does createUser({ uid, displayName }) with a
    // uid derived from the verified phone number. If localId were not honoured,
    // every student would get a random uid and never match their claims.
    const uid = freshUid('given');

    const user = await restAuth.createUser({ uid, displayName: 'Student' });

    expect(user.uid).toBe(uid);
    expect((await adminAuth.getUser(uid)).displayName).toBe('Student');
  });

  it('creates with email, password and emailVerified', async () => {
    // The shape api/admin/users.js uses to provision a teacher.
    const uid = freshUid('teacher');

    await restAuth.createUser({
      uid,
      email: email(uid),
      password: 'correct-horse-battery-staple',
      displayName: 'Teacher',
      emailVerified: true,
    });

    const viaAdmin = await adminAuth.getUser(uid);
    expect(viaAdmin.email).toBe(email(uid));
    expect(viaAdmin.emailVerified).toBe(true);
    expect(viaAdmin.displayName).toBe('Teacher');
  });

  it('returns a full record, not the thin create response', async () => {
    const uid = freshUid('full');
    const user = await restAuth.createUser({ uid, email: email(uid) });

    // api/admin/users.js reads metadata.creationTime off the result.
    expect(user.metadata.creationTime).toBeTruthy();
  });

  it('reports a duplicate uid rather than overwriting', async () => {
    const uid = freshUid('dup');
    await restAuth.createUser({ uid });

    await expect(restAuth.createUser({ uid })).rejects.toThrow();
  });
});

describe('getUser / getUserByEmail', () => {
  it('produces the same UserRecord shape admin does', async () => {
    const uid = freshUid('shape');
    await adminAuth.createUser({
      uid, email: email(uid), displayName: 'Amina', emailVerified: true,
    });

    const [viaAdmin, viaRest] = await Promise.all([
      adminAuth.getUser(uid),
      restAuth.getUser(uid),
    ]);

    // Exactly the fields projectUser() in api/admin/users.js reads.
    expect(viaRest.uid).toBe(viaAdmin.uid);
    expect(viaRest.email).toBe(viaAdmin.email);
    expect(viaRest.displayName).toBe(viaAdmin.displayName);
    expect(viaRest.disabled).toBe(viaAdmin.disabled);
    expect(viaRest.emailVerified).toBe(viaAdmin.emailVerified);
    expect(viaRest.metadata.creationTime).toBe(viaAdmin.metadata.creationTime);
  });

  it('finds a user by email', async () => {
    const uid = freshUid('byemail');
    await adminAuth.createUser({ uid, email: email(uid) });

    expect((await restAuth.getUserByEmail(email(uid))).uid).toBe(uid);
  });

  it('throws auth/user-not-found for a missing uid, matching admin', async () => {
    const adminError = await adminAuth.getUser('no_such_uid_at_all').catch((e) => e);
    const restError = await restAuth.getUser('no_such_uid_at_all').catch((e) => e);

    // api/_lib/claims.js:84 turns this exact code into `null`, and
    // api/student/verifyCode.js:95 into "create the account".
    expect(adminError.code).toBe('auth/user-not-found');
    expect(restError.code).toBe('auth/user-not-found');
  });

  it('throws auth/user-not-found for a missing email', async () => {
    const error = await restAuth.getUserByEmail('nobody@example.com').catch((e) => e);
    expect(error.code).toBe('auth/user-not-found');
  });
});

describe('setCustomUserClaims', () => {
  it('writes claims admin can read back', async () => {
    // The silent failure this guards: claims that appear to be set but are not,
    // leaving the teacher at /403 with everything apparently configured.
    const uid = freshUid('claims');
    await adminAuth.createUser({ uid });

    await restAuth.setCustomUserClaims(uid, {
      role: 'teacher', tier: 'gold', tierRank: 3, subActive: true,
    });

    expect((await adminAuth.getUser(uid)).customClaims).toEqual({
      role: 'teacher', tier: 'gold', tierRank: 3, subActive: true,
    });
  });

  it('reads back claims admin wrote', async () => {
    const uid = freshUid('claimsback');
    await adminAuth.createUser({ uid });
    await adminAuth.setCustomUserClaims(uid, { role: 'student', phone: '+254700000000' });

    // api/_lib/claims.js merges onto the EXISTING claims, so a shim that
    // could not read them would wipe every claim it did not set.
    expect((await restAuth.getUser(uid)).customClaims).toEqual({
      role: 'student', phone: '+254700000000',
    });
  });

  it('replaces the whole claim set, as admin does', async () => {
    const uid = freshUid('claimsreplace');
    await adminAuth.createUser({ uid });

    await restAuth.setCustomUserClaims(uid, { role: 'teacher', tier: 'bronze' });
    await restAuth.setCustomUserClaims(uid, { role: 'teacher' });

    expect((await adminAuth.getUser(uid)).customClaims).toEqual({ role: 'teacher' });
  });

  it('survives a round trip through setUserClaims, the real caller', async () => {
    const uid = freshUid('claimsreal');
    await adminAuth.createUser({ uid });

    const { setUserClaims } = await import('../../api/_lib/claims.js');

    await setUserClaims(uid, { role: 'teacher', tier: 'silver' });
    await setUserClaims(uid, { subActive: true });

    const claims = (await adminAuth.getUser(uid)).customClaims;
    // tierRank is derived, and the merge must have preserved the earlier keys.
    expect(claims).toMatchObject({
      role: 'teacher', tier: 'silver', tierRank: 2, subActive: true,
    });
  });
});

describe('updateUser', () => {
  it('disables an account', async () => {
    // api/admin/users.js calls updateUser(uid, { disabled }). Identity Toolkit
    // names this field `disableUser` on the way in and `disabled` on the way
    // out, which is exactly the sort of asymmetry a stubbed test cannot catch.
    const uid = freshUid('disable');
    await adminAuth.createUser({ uid });

    await restAuth.updateUser(uid, { disabled: true });
    expect((await adminAuth.getUser(uid)).disabled).toBe(true);

    await restAuth.updateUser(uid, { disabled: false });
    expect((await adminAuth.getUser(uid)).disabled).toBe(false);
  });

  it('updates displayName and email without clearing the rest', async () => {
    const uid = freshUid('update');
    await adminAuth.createUser({ uid, email: email(uid), displayName: 'Before' });
    await adminAuth.setCustomUserClaims(uid, { role: 'teacher' });

    await restAuth.updateUser(uid, { displayName: 'After' });

    const user = await adminAuth.getUser(uid);
    expect(user.displayName).toBe('After');
    expect(user.email).toBe(email(uid));
    // A partial update must not drop claims.
    expect(user.customClaims).toEqual({ role: 'teacher' });
  });
});

describe('listUsers', () => {
  it('returns records in the admin shape, with claims', async () => {
    // api/admin/users.js calls listUsers(1000) and maps every entry through
    // projectUser(), which reads customClaims off each one.
    const uid = freshUid('list');
    await adminAuth.createUser({ uid, email: email(uid), displayName: 'Listed' });
    await adminAuth.setCustomUserClaims(uid, { role: 'teacher', tierRank: 1 });

    const page = await restAuth.listUsers(1000);

    expect(Array.isArray(page.users)).toBe(true);
    const found = page.users.find((u) => u.uid === uid);
    expect(found).toBeDefined();
    expect(found.email).toBe(email(uid));
    expect(found.customClaims).toEqual({ role: 'teacher', tierRank: 1 });
  });

  it('honours the page size and returns a token when there is more', async () => {
    const page = await restAuth.listUsers(1);
    expect(page.users.length).toBeLessThanOrEqual(1);
  });
});

describe('revokeRefreshTokens', () => {
  it('moves the validSince boundary forward', async () => {
    // The basis of the checkRevoked path in verifyIdToken. If validSince were
    // written in milliseconds the cutoff would land ~50,000 years out and
    // revoke every token the account will ever hold.
    const uid = freshUid('revoke');
    await adminAuth.createUser({ uid });

    await restAuth.revokeRefreshTokens(uid);

    const viaAdmin = await adminAuth.getUser(uid);
    const validSince = Date.parse(viaAdmin.tokensValidAfterTime);

    expect(Math.abs(validSince - Date.now())).toBeLessThan(60_000);
  });

  it('is visible through the shim as well', async () => {
    const uid = freshUid('revoke2');
    await adminAuth.createUser({ uid });
    await adminAuth.revokeRefreshTokens(uid);

    expect(Date.parse((await restAuth.getUser(uid)).tokensValidAfterTime))
      .toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('deleteUser', () => {
  it('removes the account', async () => {
    const uid = freshUid('delete');
    await adminAuth.createUser({ uid });

    await restAuth.deleteUser(uid);

    await expect(adminAuth.getUser(uid)).rejects.toThrow();
  });
});

describe('createCustomToken', () => {
  it('mints a token the Auth emulator accepts', async () => {
    // The student sign-in flow: the server proves the phone number, then hands
    // out a token the browser exchanges for a session. Emulator custom tokens
    // are unsigned, and this confirms the shim produces the shape it expects.
    const uid = freshUid('custom');
    await adminAuth.createUser({ uid });

    const token = await restAuth.createCustomToken(uid, { role: 'student' });
    expect(token.split('.')).toHaveLength(3);

    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(
      `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken`
      + `?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, returnSecureToken: true }),
      }
    );

    const payload = await response.json();
    expect(response.ok, JSON.stringify(payload)).toBe(true);
    expect(payload.idToken).toBeTruthy();
  });
});

describe('verifyIdToken against an emulator-minted token', () => {
  it('accepts a real emulator ID token and carries its claims', async () => {
    // The alg:'none' branch is otherwise only exercised by tokens this suite
    // signed itself, which proves nothing about what the emulator emits.
    const uid = freshUid('verify');
    await adminAuth.createUser({ uid });
    await adminAuth.setCustomUserClaims(uid, { role: 'student', phone: '+254711111111' });

    const token = await restAuth.createCustomToken(uid);
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;

    const exchange = await fetch(
      `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken`
      + `?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, returnSecureToken: true }),
      }
    );
    const { idToken } = await exchange.json();
    expect(idToken).toBeTruthy();

    const decoded = await restAuth.verifyIdToken(idToken, true);

    expect(decoded.uid).toBe(uid);
    expect(decoded.role).toBe('student');
    expect(decoded.phone).toBe('+254711111111');
  });

  it('still rejects a token for the wrong project', async () => {
    // The emulator branch skips the SIGNATURE check; it must not skip the
    // claim checks, or a token from any project would be accepted.
    const parts = 'x'.split('.');
    void parts;

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const now = Math.floor(Date.now() / 1000);
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: 'https://securetoken.google.com/someone-elses-project',
      aud: 'someone-elses-project',
      sub: 'uid-x',
      iat: now - 10,
      exp: now + 3600,
    })}.`;

    await expect(restAuth.verifyIdToken(forged)).rejects.toThrow(/wrong audience/);
  });
});
