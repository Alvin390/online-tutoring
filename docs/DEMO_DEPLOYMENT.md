# Demo mode, and a separate demo copy

Two ways to show the app without touching a real school's money or messages.

## 1. The demo preset on a school (Superadmin → Settings → Modes)

**Demo mode → Turn demo on** does three things at once:

- **Payments go to test** (Paystack test keys and plans): no real money.
- **SMS go to fake:** nothing is sent and no SMS units are used. Check-in codes are read out by the teacher.
- **A DEMO ribbon** appears for teachers and students.

**Turn demo off** puts payments and SMS back exactly as they were. A switch that was never chosen goes back to "from the server settings".

Notes:

- **M-Pesa "Pay now" is not changed by the preset.** It has its own Off / Demo / Live setting, and its Demo would show Pay now to real blocked students (see `docs/STK_PUSH_PILOT.md`).
- **In a paid period on live payments,** the preset asks you to type TEST, like the payments switch.
- **Timing:** changes take effect within a minute or two everywhere. The mode is read every 30 s, and the screens' bootstrap is cached about a minute.
- **The real school is still the real school.** Its students and teachers keep using it during a demo. For a demo in front of strangers, use a separate copy (below).

## 2. A separate demo copy (its own Firebase project and Worker)

A copy that never touches a real school. Sample data only.

> **CONFIRM (owner):** the demo's address, for example `demo-<name>.<your-subdomain>.workers.dev` or a custom subdomain. Until it is chosen, this guide writes `<DEMO_URL>`.

### a. Firebase

1. **Create a new Firebase project.** Its id must contain `demo`, for example `online-tutoring-demo`. The seed script refuses any other id, and always refuses production.
2. **Enable Authentication** (Email/Password) and **Firestore** (production mode, the same region as the school).
3. **Deploy the rules and indexes:**
   `npx firebase deploy --only firestore --project <demo-project-id>`
4. **Create a service account key:** Project settings → Service accounts → Generate new private key. Keep the JSON out of the repo.

### b. The Worker

1. **Build the site with the demo project's web config** (Project settings → Your apps → Web app):

   ```
   VITE_FIREBASE_PROJECT_ID=<demo-project-id> VITE_FIREBASE_API_KEY=… VITE_FIREBASE_AUTH_DOMAIN=… \
   VITE_FIREBASE_APP_ID=… VITE_PAYSTACK_MODE=test VITE_SENTRY_DSN= npm run build
   ```

2. **Deploy under a different Worker name,** so it never replaces the school's:
   `npx wrangler deploy --name online-tutoring-demo`
3. **Set its secrets** with `npx wrangler secret put <NAME> --name online-tutoring-demo`:

   | Secret | Value |
   | --- | --- |
   | `FIREBASE_SERVICE_ACCOUNT` | the demo project's JSON (one line) |
   | `APP_ENCRYPTION_KEY` | a NEW key (never the school's) |
   | `CRON_SECRET` | a NEW random value |
   | `PUBLIC_BASE_URL` | `<DEMO_URL>` |
   | `PAYSTACK_MODE` | `test` |
   | `PAYSTACK_SECRET_KEY_TEST`, `PAYSTACK_PLAN_*_TEST` | the test key and test plan codes (no live keys) |
   | `SMS_MODE` | `fake`. No `HASHBACK_API_KEY` is needed. |
   | `DARAJA_SANDBOX_*` | the sandbox keys, if "Pay now" should be shown (Demo) |

   Leave out every live key (`PAYSTACK_SECRET_KEY_LIVE`, `DARAJA_LIVE_*`, `HASHBACK_API_KEY`, `GMAIL_*`). Then the copy cannot reach real money, real phones or real email, whatever is switched on it.

### c. Sample data

Run once, from this repository, with the demo project's service account:

```
FIREBASE_SERVICE_ACCOUNT='<demo JSON>' \
DEMO_TEACHER_EMAIL=teacher@<your-domain> DEMO_TEACHER_PASSWORD=<choose> \
DEMO_SUPERADMIN_EMAIL=admin@<your-domain> DEMO_SUPERADMIN_PASSWORD=<choose> \
  node scripts/seedDemo.mjs
```

It creates:

- **Two sessions** (Morning, Evening).
- **40 sample students.** Every name is "<first name> Demo", every number is in the unused +254 700 00x block, and some are blocked or pending, to show those screens.
- **A teacher login (the owner) and a superadmin login.**
- **Gold (gifted), with fees, billing, SMS and M-Pesa switched on.**
- **The demo preset on**, and M-Pesa Pay now on Demo (sandbox). It never touches fees, and there are no real students here.

It is safe to run again: it overwrites the same sample records.

### d. Check

- Open `<DEMO_URL>`: the DEMO ribbon shows.
- Sign in as the teacher. The students table shows the "… Demo" names, and the banners say test payments and SMS not sent.
- `<DEMO_URL>/api/health` answers `ok`.

### Taking it down

Delete the Worker (`npx wrangler delete --name online-tutoring-demo`) and the Firebase project. Nothing of a real school is in either.
