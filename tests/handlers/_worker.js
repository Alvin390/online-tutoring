/**
 * Worker-level test harness — Phase 13 / 01 D2.
 *
 * Drives requests through the REAL Worker entry (worker/index.js), so the route
 * table, nodeCompat and createHandler are exercised end to end against the
 * emulators — not just library functions in isolation.
 *
 *   - pinEnv()            points every credential at the emulators BEFORE any
 *                         api/ module loads, with fake third-party secrets
 *   - installFetchGuard() emulator hosts pass through; Safaricom, Paystack and
 *                         Google OAuth/Gmail get canned responses and are
 *                         RECORDED; anything else throws. Nothing in a test
 *                         using this harness can reach a real external service.
 *   - call()              one request through worker.fetch, as Cloudflare would
 *   - userWithClaims()    an emulator user with custom claims and a real ID token
 *
 * Promoted from issues/validation/e2e/harness.js, which validated the Phase 13
 * findings.
 */

export const PROJECT = 'demo-online-tutoring';
export const FS_HOST = '127.0.0.1:8085';
export const AUTH_HOST = '127.0.0.1:9099';

export const TEST_ENV = Object.freeze({
  FIRESTORE_EMULATOR_HOST: FS_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
  GCLOUD_PROJECT: PROJECT,
  FIREBASE_SERVICE_ACCOUNT: '',
  FIREBASE_STORAGE_BUCKET: '',
  METADATA_SERVER_DETECTION: 'none',
  GCE_METADATA_HOST: '0.0.0.0',
  PUBLIC_BASE_URL: 'https://validation.example',
  CRON_SECRET: 'test-cron-secret',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PAYSTACK_MODE: 'test',
  PAYSTACK_SECRET_KEY_TEST: 'sk_test_harness_only',
  PAYSTACK_PLAN_BRONZE_TEST: 'PLN_bronze',
  PAYSTACK_PLAN_SILVER_TEST: 'PLN_silver',
  PAYSTACK_PLAN_GOLD_TEST: 'PLN_gold',
  DARAJA_MODE: 'sandbox',
  DARAJA_SANDBOX_SHORTCODE: '174379',
  DARAJA_SANDBOX_SHORTCODE_TYPE: 'paybill',
  DARAJA_SANDBOX_CONSUMER_KEY: 'ck_harness',
  DARAJA_SANDBOX_CONSUMER_SECRET: 'cs_harness',
  DARAJA_SANDBOX_PASSKEY: 'pk_harness',
  DARAJA_CALLBACK_IPS: '196.201.214.200',
  SUBREQUEST_BUDGET: '200',
  GMAIL_CLIENT_ID: 'gmail-client-harness',
  GMAIL_CLIENT_SECRET: 'gmail-secret-harness',
  GMAIL_REFRESH_TOKEN: 'gmail-refresh-harness',
  GMAIL_SENDER: 'alerts.harness@example.com',
});

export const SAFARICOM_IP = '196.201.214.200';

export function pinEnv(overrides = {}) {
  Object.assign(process.env, TEST_ENV, overrides);
}

/** Every external call the code under test attempted, with parsed bodies. */
export const externalCalls = [];

/**
 * Knobs for the fakes. Tests mutate these to inject failures.
 *   daraja.queryResultCode  ResultCode the fake STK status query returns
 *   paystack.fail           { [pathFragment]: httpStatus } — fail matching calls
 *   gmail.fail              HTTP status for the next Gmail send(s), or null
 *   gmail.oauthError        error string for the token endpoint, or null
 */
export const fakes = {
  daraja: { queryResultCode: '0', seq: 0 },
  paystack: { fail: {}, seq: 0 },
  // hold: a promise the fake Gmail send awaits before answering.
  gmail: { fail: null, oauthError: null, seq: 0, hold: null },
  storage: { fail: null, objects: new Map() },
};

export function resetFakes() {
  externalCalls.length = 0;
  fakes.daraja.queryResultCode = '0';
  fakes.paystack.fail = {};
  fakes.gmail.fail = null;
  fakes.gmail.oauthError = null;
  fakes.gmail.hold = null;
  fakes.storage.fail = null;
  fakes.storage.objects.clear();
}

/**
 * A throwaway service-account key, for code paths that SIGN (Storage signed
 * URLs, Storage OAuth). Generated per run; never a real credential. Firestore
 * and Auth still use the emulators because their emulator hosts are set.
 */
export async function useFakeServiceAccount() {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: PROJECT,
    client_email: 'harness@demo-online-tutoring.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  process.env.FIREBASE_STORAGE_BUCKET = 'fake-bucket';
  (await import('../../api/_lib/googleAuth.js')).__resetCredentialCaches?.();
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function parseBody(body) {
  if (body == null) return null;
  const text = typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : String(body);
  try { return JSON.parse(text); } catch { return text; }
}

let realFetch = null;

export function installFetchGuard() {
  if (realFetch) return;
  realFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const { hostname, pathname } = new URL(url);

    if (hostname === '127.0.0.1' || hostname === 'localhost') return realFetch(input, init);

    const call = { url, method: init.method ?? 'GET', body: parseBody(init.body) };
    externalCalls.push(call);

    if (hostname.endsWith('safaricom.co.ke')) {
      if (pathname.includes('/oauth/')) return json({ access_token: 'fake-daraja-token', expires_in: '3599' });
      if (pathname.includes('stkpushquery')) {
        return json({ ResponseCode: '0', ResultCode: fakes.daraja.queryResultCode, ResultDesc: 'fake' });
      }
      if (pathname.includes('stkpush')) {
        fakes.daraja.seq += 1;
        return json({
          MerchantRequestID: `m_${fakes.daraja.seq}`,
          CheckoutRequestID: `ws_CO_TEST_${fakes.daraja.seq}_${Date.now()}`,
          ResponseCode: '0',
          ResponseDescription: 'Success. Request accepted for processing',
          CustomerMessage: 'ok',
        });
      }
    }

    if (hostname === 'api.paystack.co') {
      for (const [fragment, status] of Object.entries(fakes.paystack.fail)) {
        if (pathname.includes(fragment)) return json({ status: false, message: 'fake failure' }, status);
      }
      fakes.paystack.seq += 1;
      if (pathname === '/subscription' && call.method === 'POST') {
        return json({ status: true, data: { subscription_code: `SUB_fake_${fakes.paystack.seq}`, email_token: `tok_${fakes.paystack.seq}` } });
      }
      return json({ status: true, message: 'fake', data: {} });
    }

    if (hostname === 'storage.googleapis.com') {
      if (fakes.storage.fail) return json({ error: { code: fakes.storage.fail } }, fakes.storage.fail);
      if ((init.method ?? 'GET') === 'DELETE') {
        const name = decodeURIComponent(pathname.split('/o/')[1] ?? '');
        fakes.storage.objects.delete(name);
        return new Response(null, { status: 204 });
      }
      // Multipart upload: the object name is in the JSON metadata part.
      const raw = typeof init.body === 'string' ? init.body : Buffer.from(init.body ?? '').toString('latin1');
      const metaLine = raw.split(/\r?\n/).find((line) => line.startsWith('{') && line.includes('"name"'));
      const meta = JSON.parse(metaLine ?? '{}');
      fakes.storage.objects.set(meta.name, { contentType: meta.contentType, bytes: raw.length });
      return json({ name: meta.name, bucket: 'fake-bucket', contentType: meta.contentType });
    }

    if (hostname === 'oauth2.googleapis.com') {
      if (fakes.gmail.oauthError) return json({ error: fakes.gmail.oauthError }, 400);
      return json({ access_token: 'fake-gmail-token', expires_in: 3599, token_type: 'Bearer' });
    }

    if (hostname === 'gmail.googleapis.com') {
      if (fakes.gmail.hold) await fakes.gmail.hold;
      if (fakes.gmail.fail) return json({ error: { code: fakes.gmail.fail, message: 'fake gmail failure' } }, fakes.gmail.fail);
      fakes.gmail.seq += 1;
      return json({ id: `gmail_${fakes.gmail.seq}`, threadId: `t_${fakes.gmail.seq}`, labelIds: ['SENT'] });
    }

    throw new Error(`Test fetch guard: blocked external call to ${url}`);
  };
}

/** Decodes a recorded Gmail send into its raw RFC 5322 text. */
export function decodeGmailRaw(call) {
  const raw = call?.body?.raw;
  if (!raw) return null;
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

let worker;
export async function loadWorker() {
  if (!worker) worker = (await import('../../worker/index.js')).default;
  return worker;
}

let ipCounter = 10;
function nextIp() {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 65000) % 250}.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`;
}

/** Records every promise handed to ctx.waitUntil, so tests can await them. */
export const waitUntilPromises = [];

export async function drainWaitUntil() {
  while (waitUntilPromises.length) {
    await Promise.allSettled(waitUntilPromises.splice(0));
  }
}

/**
 * One request through the Worker, as Cloudflare would deliver it.
 *
 * Background work (waitUntil — audit writes since Phase 13 / 08 C3, emails,
 * heartbeats) is drained before returning by default, so a test can assert on
 * what the request wrote. `drain: false` returns at the moment the response
 * is ready, to prove something was NOT on the response path.
 * @returns {Promise<{status:number, body:any, headers:Headers}>}
 */
export async function call(path, { method = 'POST', body, token, ip, headers = {}, drain = true, env = {} } = {}) {
  const w = await loadWorker();
  const h = new Headers({ 'cf-connecting-ip': ip ?? nextIp(), ...headers });
  if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
  if (token) h.set('authorization', `Bearer ${token}`);

  const request = new Request(`https://validation.example${path}`, {
    method,
    headers: h,
    body: body === undefined || method === 'GET' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  const ctx = {
    waitUntil(promise) { waitUntilPromises.push(Promise.resolve(promise)); },
    passThroughOnException() {},
  };

  // `env` carries Worker bindings a test wants to fake (002Fixes / 07).
  const response = await w.fetch(request, env, ctx);
  const text = await response.text();
  if (drain) await drainWaitUntil();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: response.status, body: parsed, headers: response.headers };
}

/** An emulator user with custom claims, signed in for a real ID token. */
export async function userWithClaims(uid, claims, { email } = {}) {
  const authRest = await import('../../api/_lib/authRest.js');
  const address = email ?? `${uid}@harness.example`;
  const password = 'harness-pass-123';
  try {
    await authRest.createUser({ uid, email: address, password, emailVerified: true, displayName: uid });
  } catch (err) {
    if (!/exists/i.test(String(err?.code ?? err?.message))) throw err;
  }
  await authRest.setCustomUserClaims(uid, claims);

  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error(`sign-in failed: ${JSON.stringify(data)}`);
  return data.idToken;
}

export const teacherClaims = {
  gold: { role: 'teacher', tier: 'gold', tierRank: 3, subActive: true },
  silver: { role: 'teacher', tier: 'silver', tierRank: 2, subActive: true },
  bronze: { role: 'teacher', tier: 'bronze', tierRank: 1, subActive: true },
  superadmin: { role: 'superadmin', tier: 'gold', tierRank: 3, subActive: true },
};

export async function getTestDb() {
  const { getDb } = await import('../../api/_lib/firebaseAdmin.js');
  return getDb();
}

/** Replaces config/flags and waits out the server's 30 s flag cache. */
export async function setFlags(db, flags) {
  await db.doc('config/flags').set(flags);
  const mod = await import('../../api/_lib/flags.js');
  mod.__resetFlagCache?.();
}

/** Deletes every document in the emulator's default database for PROJECT. */
export async function clearFirestore() {
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const mod = await import('../../api/_lib/flags.js');
  mod.__resetFlagCache?.();
}

export const phoneN = (n) => `+2547${String(n).padStart(8, '0')}`;
