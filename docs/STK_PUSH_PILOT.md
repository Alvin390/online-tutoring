# M-Pesa STK push: switched off for the pilot

**Status (October 2026):** the "Pay now" M-Pesa STK push on the blocked-student
screen is **commented out**, not removed. During the pilot, a blocked student
pays manually (till/paybill) and pastes the whole M-PESA confirmation message
into the receipt box; the teacher approves it from the dashboard, as before.

Everything behind the button is still deployed and untouched: the
`/api/payments/*` endpoints, the Daraja callback, the reconcile cron, the
ledger posting and the `PayNowPanel` component. Only the screen no longer
shows it, so nothing can start an STK push.

## What was changed

| File | Change |
| --- | --- |
| `src/features/registration/components/BlockedStudentScreen.jsx` | Three blocks marked `STK (1/3)`, `STK (2/3)`, `STK (3/3)` are commented out; `lazy, Suspense` dropped from the React import; an `eslint-disable no-unused-vars` comment around the props (`session`, `phoneNumber`, `onPaid` are only used by the panel) |
| `tests/unit/phase13/payments.test.jsx` | `Gold deployment: the Pay now panel is shown` is `it.skip`; a `pilot: no Pay now …` test was added |
| `tests/unit/phase13/paidRedirect.test.jsx` | `PayNowPanel receives the handler` is `it.skip` |

The receipt box placeholder (registration form and blocked screen) was changed
at the same time to *"Please Paste Entire M-PESA receipt message here. You may
remove your account balance"*. That is independent of STK and can stay.

## Switching it back on

### 1. Code

In `src/features/registration/components/BlockedStudentScreen.jsx`:

1. Change the first import back to
   `import { useState, useMemo, lazy, Suspense } from 'react';`
2. Uncomment **STK (1/3)**: the `useMpesaAvailable` import and the
   `PayNowPanel` lazy import.
3. Uncomment **STK (2/3)**: `const mpesaAvailable = useMpesaAvailable();`
4. Uncomment **STK (3/3)**: the `{mpesaAvailable && blockState.balance > 0 && (…)}`
   block. It sits inside a `{/* … */}` JSX comment; remove the opening
   `{/* STK (3/3): …` line's comment markers and the closing `*/}` so the
   explanatory sentence stays a comment and the JSX becomes live again.
5. Delete the `eslint-disable no-unused-vars` / `eslint-enable` pair around the
   props, and the "SWITCHED OFF FOR THE PILOT" note at the top of the file.

In the tests:

6. `tests/unit/phase13/payments.test.jsx`: change `it.skip('Gold deployment: …')`
   back to `it(…)` and delete the `pilot: no Pay now …` test.
7. `tests/unit/phase13/paidRedirect.test.jsx`: change
   `it.skip('PayNowPanel receives the handler', …)` back to `it(…)`.

Then run `npm run lint` and `npx vitest run`.

### 2. Live Daraja keys (Cloudflare Worker secrets)

The Pay now button only appears when the server says M-Pesa is available:
the `payments.daraja` flag is on, the plan is Gold, and credentials for the
current `DARAJA_MODE` exist. Set the live values as Worker secrets (never in
the repo):

```bash
npx wrangler secret put DARAJA_MODE                # live
npx wrangler secret put DARAJA_LIVE_SHORTCODE
npx wrangler secret put DARAJA_LIVE_SHORTCODE_TYPE # till or paybill (wrong type = prompt never arrives)
npx wrangler secret put DARAJA_LIVE_CONSUMER_KEY
npx wrangler secret put DARAJA_LIVE_CONSUMER_SECRET
npx wrangler secret put DARAJA_LIVE_PASSKEY
```

`PUBLIC_BASE_URL` must be the HTTPS site address (the callback is built from
it). `DARAJA_CALLBACK_IPS` and `DARAJA_CALLBACK_SECRET` are optional; see
`.env.example` and `docs/LAUNCH.md` for every variable.

Going live needs Safaricom's approval of the production app for the teacher's
till or paybill, which can take days. Start that before the code change.

### 3. Release and check

1. Push to a branch and open a PR; test on the branch preview with a small
   real payment (KES 1) against a test student.
2. Merge to `master`, then promote the version built from the merge commit:
   `npx wrangler versions deploy <version-id>@100% -y`.
3. On the live site: a blocked student with a balance sees **Pay now**, the
   prompt reaches the phone, and after paying the statement updates and the
   student is let into class. The superadmin **Test connection** for Daraja
   should be green.
