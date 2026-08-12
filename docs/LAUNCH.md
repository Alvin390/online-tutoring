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
 2. Set server env vars       (see §2)
 3. Deploy the app            git push  (CI deploys to Vercel)
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

Set in Vercel as **encrypted** environment variables. None of these belong in
git; `.env.local` is gitignored and is for local development only.

| Variable | Needed by | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | everything server-side | Raw JSON or base64 |
| `APP_ENCRYPTION_KEY` | Daraja credentials | `openssl rand -base64 32`, exactly 32 bytes |
| `CRON_SECRET` | all three crons | **Without it the crons return 401 and never run** |
| `PUBLIC_BASE_URL` | Paystack callbacks, Daraja callback, calendar feeds | No trailing slash |
| `PAYSTACK_SECRET_KEY` | billing | Enable IP whitelisting once Vercel egress IPs are known |
| `PAYSTACK_PLAN_BRONZE/_SILVER/_GOLD` | billing | Plan codes from the Paystack dashboard |
| `VITE_PAYSTACK_PUBLIC_KEY` | checkout | Public by design |
| `DARAJA_CALLBACK_IPS` | M-Pesa | Optional override; Safaricom has changed these historically |

Verify with `GET /api/health` — it returns `{ status: 'ok', firestore: 'ok' }`
when credentials resolve.

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
- [ ] Handler tests green; `npm run test:handlers` (18 tests)
- [ ] No PII in any log, Sentry event or error response
- [ ] All secrets in Vercel env, none in git
- [ ] **Git history audited for previously committed secrets.** `.gitignore:36`
      names a Firebase admin SDK JSON path, which suggests one was in the tree
      at some point. If it is reachable in history, **rotate the key in the
      Firebase console** — deleting the file does not invalidate it
- [ ] CSP switched from `Content-Security-Policy-Report-Only` to
      `Content-Security-Policy` after a week of clean reports
- [ ] Rate limits verified on every public endpoint
- [ ] Paystack IP whitelisting on
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

- [ ] All 27 test files green (`npm run test:all`)
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

1. Rotate `PAYSTACK_SECRET_KEY` in the Paystack dashboard, update Vercel.
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
- **App:** Vercel dashboard → previous deployment → Promote
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
| Initial JS 269.8 KB vs 180 KB target | Firebase SDK is ~131 KB of it | Phase 10 |

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
