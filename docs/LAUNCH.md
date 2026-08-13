# Launch checklist & runbooks

Phase 11 D7/D8. This is the operational half of the upgrade: what to do before
going live, and what to do when something breaks at 22:00 on a Sunday.

Kept in `docs/` rather than `upgrade/` because `upgrade/` is gitignored, and a
runbook nobody can find during an incident is not a runbook.

---

## 1. Deployment order

The phases have dependencies, and getting the order wrong locks the teacher out
of their own dashboard. Follow it exactly.

```
 1. Deploy rules + indexes    firebase deploy --only firestore,storage
 2. Upload server secrets     npm run cf:secrets            (see §2)
 3. Deploy the app            npm run deploy                (vite build && wrangler deploy)
 4. npm run seed:superadmin   creates the superadmin, prints its uid
 5. Sign in as superadmin, enable MFA
 6. POST /api/admin/setRole   { email: <teacher>, role: 'teacher', tier: 'bronze' }
 7. npm run seed:sessions     creates morning/evening, copies class links
 8. Verify /morning and /evening still resolve
 9. Flip flags, ONE AT A TIME, verifying between each  (see §3)
```

**Step 6 before step 9 is not optional.** Enabling `auth.roles` before the
teacher has a role claim sends them to `/403` — the rules-side fallback still
serves their data, but the client gate refuses the route.

---

## 2. Environment variables

**Phase 12 split them in two, and mixing them up is the usual way a deploy
breaks.**

### Build-time — stay in `.env.local`

The 14 `VITE_*` variables. Vite inlines them into the browser bundle at build
time, so they are **public by construction** and must never hold a secret. They
are not uploaded to Cloudflare and the Worker cannot read them at runtime.

### Runtime — Cloudflare secrets

Everything else. The Worker reads them through `process.env`, which Cloudflare
populates from vars and secrets (the `compatibility_date` is after 2025-04-01,
so `nodejs_compat_populate_process_env` is on by default).

```bash
npm run cf:secrets -- --dry-run     # list what would upload, no values shown
npm run cf:secrets                  # upload everything that has a value
npm run cf:secrets -- --only PAYSTACK_SECRET_KEY_LIVE
```

Locally, `wrangler dev` reads `.dev.vars` (gitignored) instead. Keep it in step
with the runtime half of `.env.local`.

| Variable | Needed by | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | everything server-side | Raw JSON or base64 |
| `FIREBASE_STORAGE_BUCKET` | WhatsApp attachments | This project uses `.firebasestorage.app`, **not** `.appspot.com` |
| `APP_ENCRYPTION_KEY` | Daraja credentials | `openssl rand -base64 32`, exactly 32 bytes |
| `CRON_SECRET` | all three sweeps | **Without it the sweeps refuse to run — and `scheduled()` logs an error rather than failing silently** |
| `PUBLIC_BASE_URL` | Paystack callbacks, Daraja callback, calendar feeds | No trailing slash. Set to the `*.workers.dev` URL until a custom domain exists |
| `PAYSTACK_SECRET_KEY_TEST/_LIVE` | billing | Selected by `PAYSTACK_MODE` |
| `PAYSTACK_PLAN_BRONZE/_SILVER/_GOLD` `_TEST/_LIVE` | billing | Plan codes from the Paystack dashboard |
| `DARAJA_*_SANDBOX/_LIVE` | M-Pesa | Selected by `DARAJA_MODE` |
| `DARAJA_CALLBACK_IPS` | M-Pesa | Optional override; Safaricom has changed these historically. An override that parses to nothing falls back to the published defaults rather than emptying the allowlist |
| `EXPOSE_DEV_OTP` | testing only | Returns the student OTP in the API response. **Leave blank anywhere real** — setting it to `true` defeats phone verification |

Non-secret tuning knobs live in `wrangler.jsonc` under `vars`:
`SUBREQUEST_BUDGET` and `SWEEP_BATCH_SIZE` (see §8).

Verify with `GET /api/health` — it returns `{ status: 'ok', firestore: 'ok' }`
when credentials resolve. `npm run health` runs the same checks locally, plus
Paystack and Daraja connectivity.

---

## 3. Flag rollout order

Every gated feature defaults **off**. Deploying changes nothing user-visible
until these are flipped, which is the whole point — flip one, verify, then flip
the next.

| Order | Flag | Verify before moving on |
|---|---|---|
| 1 | `auth.roles` | Teacher reaches `/dashboard`; superadmin reaches `/superadmin` |
| 2 | `notes.enabled` | Notes tab appears; a student cannot read notes (check rules test) |
| 3 | `registration.requireApproval` | New registration lands in the pending queue, not in class |
| 4 | `fees.enabled` | Record a payment; balance updates; partial payment leaves a block in place |
| 5 | `calendar.enabled` | Create an event; student sees only their session's |
| 6 | `whatsapp.broadcast` | Send to two students end to end |
| 7 | `billing.enabled` | **Paystack test mode first.** Webhook lands, status changes |
| 8 | `whatsapp.advanced` | Gold only — attachments and filters |
| 9 | `payments.daraja` | **Sandbox first**, full flow, then production credentials |
| 10 | `sessions.teacherDefined` | Create a third session; its students appear on the dashboard |

`auth.legacyStudentRead` starts **on** and stays on until every active student
has verified their phone. Turning it off early locks existing students out of
check-in entirely.

---

## 4. Pre-launch checklist

### Security

- [ ] Rules deployed; `npm run test:rules` green (124 tests)
- [ ] Handler tests green; `npm run test:handlers` (76 tests)
- [ ] No PII in any log, Sentry event or error response
- [ ] All runtime secrets uploaded with `npm run cf:secrets`, none in git;
      `.dev.vars` and `.env.local` both gitignored
- [ ] **Git history audited for previously committed secrets.** `.gitignore:36`
      names a Firebase admin SDK JSON path, which suggests one was in the tree
      at some point. If it is reachable in history, **rotate the key in the
      Firebase console** — deleting the file does not invalidate it
- [ ] CSP switched from `Content-Security-Policy-Report-Only` to
      `Content-Security-Policy` after a week of clean reports
- [ ] Rate limits verified on every public endpoint
- [ ] Paystack IP whitelisting on
- [ ] `EXPOSE_DEV_OTP` is blank in the Cloudflare secret store
- [ ] Daraja credentials encrypted; **Test connection** green
- [ ] `npm audit --audit-level=high` clean
- [ ] Penetration pass: IDOR on student documents, tier bypass, webhook forgery,
      amount tampering

### Performance

- [ ] `npm run check:bundle` passes
- [ ] **Firebase budget alerts configured — mandatory before enabling Blaze.**
      Blaze has no spend ceiling by default; a runaway listener loop can produce
      a large bill overnight
- [ ] Lighthouse ≥ 90 performance on `/`, `/morning`, `/dashboard`

### Functional

- [ ] All test files green: `npm run test:all` (643), `npm run test:rules`
      (124), `npm run test:handlers` (76)
- [ ] Paystack test-mode transaction end to end
- [ ] **Daraja sandbox end to end — this has not been run yet** (see §6)
- [ ] Every flag exercised in both positions

### Operational

- [ ] Firestore scheduled export configured, daily, 30-day retention
- [ ] **One restore tested.** An untested backup is not a backup
- [ ] Alerts routed to an inbox someone actually reads
- [ ] Superadmin account created with MFA on

---

## 5. Incident runbooks

### "Students cannot join class"

1. `GET /api/health` — is Firestore reachable?
2. Check `subscription/public.status`. If `locked` or `expired`, the teacher's
   subscription lapsed; students see "temporarily unavailable" by design.
3. Check `config/zoomLinks` or `sessions/{slug}/private/classLink` is set.
4. Check the student's `blocked` and `approvalStatus` in the dashboard.

### "A parent paid but the student is still blocked"

This is the failure that matters most. In order:

1. Find the transaction: `mpesa/transactions/items/{CheckoutRequestID}`.
2. `status: 'pending'` → the callback never arrived. The reconcile cron runs
   every 10 minutes and will resolve it; force it by calling
   `/api/cron/mpesaReconcile` with the `CRON_SECRET`.
3. `status: 'amount_mismatch'` → the callback's amount differed from what was
   initiated. **Deliberately not posted.** Verify against the M-Pesa statement
   and post manually via `/api/fees/post`.
4. No transaction at all → check `mpesa/unmatched/items` for a callback we could
   not attribute. Post manually with the M-Pesa code as `reference`.
5. Partial payment → **working as designed.** A partial payment does not clear
   a block. Either the balance is settled or the teacher unblocks by agreement.

### "The teacher is locked out but says they paid"

1. Check `billing/events/items` for the Paystack webhook.
2. Absent → the webhook did not arrive. Check the Paystack dashboard's webhook
   log and the registered URL.
3. Present but `status: 'failed'` → read the recorded error.
4. Immediate relief: superadmin can grant a tier with
   `POST /api/billing/manage { action: 'grant', tier }`, which sets
   `grantedBySuperadmin` and makes the cron skip the account.

### "Suspected credential compromise"

1. Rotate `PAYSTACK_SECRET_KEY_LIVE` in the Paystack dashboard, then
   `npm run cf:secrets -- --only PAYSTACK_SECRET_KEY_LIVE`.
2. Rotate Daraja credentials in the Safaricom portal; re-enter via the
   credentials form (this re-encrypts them; the callback secret is preserved so
   the registered URL keeps working).
3. Rotate `APP_ENCRYPTION_KEY` — note this invalidates stored Daraja ciphertext,
   so re-enter those credentials afterwards.
4. `revokeSessions: true` on `/api/admin/setRole` forces re-authentication.
5. Review `audit/` at `/superadmin` for what the compromised actor did.

### Rollback

Rules and app deploy independently:

- **Rules:** `firebase deploy --only firestore:rules` against the previous commit
- **App:** `npx wrangler rollback` (or Workers dashboard → Deployments →
  previous version → Rollback). Static assets roll back with the Worker,
  because `wrangler deploy` uploads both together
- **A feature:** flip its flag off. Every phase is reversible this way, and no
  flag deletes data

**Two endpoints must stay live regardless of any flag**: the Daraja callback and
the M-Pesa reconcile cron. Disabling them strands money a parent has already
been charged.

---

## 6. Known gaps at launch

Stated plainly so nobody discovers them under pressure.

| Gap | Impact | Where |
|---|---|---|
| **Daraja sandbox flow never executed** | Unknown whether Safaricom accepts our request shape | Phase 09 |
| Manual M-Pesa reconciliation UI not built | Unmatched payments are captured but need API access to attach | Phase 09 |
| Invoice PDF rendering not built | Ledger and numbering work; no PDF file | Phase 06 |
| Reminder queue has no drainer | Ladder computes and queues; no email provider configured | Phase 03 |
| 90-day purge detects but does not delete | Flagged and audited; deliberate — see Phase 03 notes | Phase 03 |
| E2E (Playwright) not written | Unit, rules and handler layers cover the logic | Phase 11 |
| Load testing (k6) not run | Rate limits are unit-tested, not load-tested | Phase 11 |
| `npm run lint` does not run | ESLint 9 needs `eslint.config.js`; predates this work | Phase 01 |
| Initial JS 248.9 KB vs 180 KB target | Firebase SDK is ~131 KB of it | Phase 10 |
| **Free-plan CPU ceiling untested under real load** | 10ms/invocation; sweeps are batched to fit but this is unproven in production | Phase 12 |
| Cloudflare deploy not yet run against a live account | Verified end to end in local workerd via `wrangler dev` | Phase 12 |

---

## 7. Post-launch

- **Week 1** — daily error review, Firestore cost check, teacher check-in
- **Week 2** — remove flags whose criteria are met: `auth.legacyStudentRead`
  once all students have verified; the transitional `'teacher'` fallback in
  `isTeacher()` once all staff carry role claims (a rules test will fail,
  which is the intended signal)
- **Month 1** — compare actual Firebase spend against tier pricing to confirm
  margin
- **Ongoing** — weekly Dependabot merges, quarterly key rotation, semi-annual
  restore test

---

## 8. Cloudflare Workers operations

Phase 12 moved hosting from Vercel to Cloudflare. The trigger was Vercel's Hobby
plan capping cron at **once per day** — `subscriptionSweep` needs hourly and
`mpesaReconcile` every ten minutes — and Hobby's non-commercial clause, which a
paid SaaS cannot rely on either way.

### What replaced what

| Vercel | Cloudflare |
|---|---|
| `vercel.json` rewrites | `assets.not_found_handling: "single-page-application"` |
| `vercel.json` headers | `public/_headers` **plus** `API_SECURITY_HEADERS` in `worker/index.js` |
| `vercel.json` crons | `triggers.crons` + `scheduled()` |
| filesystem routing | `worker/routes.js` |
| `vercel dev` | `wrangler dev` |
| `firebase-admin` | REST shims (`api/_lib/firestoreRest.js`, `authRest.js`, `storageRest.js`) |

**`_headers` does not apply to Worker responses** — only to static assets. The
`/api/*` security headers therefore live in `worker/index.js`. Change one, change
the other.

### Free-plan limits that shape the design

| Limit | Free | Paid ($5/mo) |
|---|---|---|
| Subrequests per invocation | **50** | 1,000 |
| CPU per invocation (HTTP and cron) | **10 ms** | 30 s |
| Requests | 100k/day | 10M/mo |
| Cron triggers | 5 | 250 |

Each Firestore REST call spends one subrequest. The sweeps are bounded and
resumable to fit (`api/_lib/sweepCursor.js`), and the Worker arms a budget of 45
per invocation so a sweep hits **our** limit first and stops cleanly with its
cursor written, rather than being killed mid-write by the platform.

**Moving to Workers Paid needs no code change** — raise `SUBREQUEST_BUDGET` to
~900 and `SWEEP_BATCH_SIZE` to ~100 in `wrangler.jsonc`.

### The CPU ceiling is the live risk

10 ms is CPU only; time waiting on I/O does not count, so ordinary API requests
are comfortable. A sweep iterating documents and signing JWTs is the case that
could exceed it. Mitigations are in place — the service-account key and its
tokens are cached at module scope so a warm isolate never re-signs, and the
Firestore assertion is self-signed with no network call — but this is **not yet
proven under production load**.

Detection: `observability` is on, so a CPU-limit breach appears in the Workers
dashboard as an `exceededCpu` outcome. Watch it in week 1.

```bash
npx wrangler tail                        # live logs
npx wrangler tail --status error         # failures only
```

Every sweep logs a single structured line (`"Scheduled sweep finished"`) with its
status and result, so a sweep that stops running is visible by absence.

### Verifying cron after a deploy

Workers dashboard → the Worker → **Settings → Trigger Events** should list all
three schedules. Then either wait for a firing and check `wrangler tail`, or run
one by hand — the HTTP routes are retained precisely for this:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<worker>/api/cron/subscriptionSweep
```

Locally:

```bash
npx wrangler dev --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=0+*+*+*+*"
```

The cron strings in `wrangler.jsonc` and `CRON_SCHEDULE_TO_SWEEP` in
`worker/index.js` **must match character for character** — Cloudflare passes the
expression back verbatim to identify which fired. `tests/unit/worker.test.js`
asserts both directions, because the failure mode is silent: the sweep simply
never runs.

### Moving to a custom domain

1. Add the domain to the Cloudflare account.
2. In `wrangler.jsonc`: `"routes": [{ "pattern": "app.example.com", "custom_domain": true }]`
3. Update `PUBLIC_BASE_URL`, the Paystack callback URL, and the Daraja callback
   URL registered with Safaricom.
