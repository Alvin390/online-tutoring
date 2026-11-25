# M-Pesa STK push ("Pay now"): Off, Demo or Live, from the superadmin page

**Status (013Fixes Release F, November 2026):** the "Pay now" M-Pesa STK push
on the blocked-student screen is back in the code. It is **not** commented
out any more. Whether a student sees it is decided on the server
(`api/_lib/mpesaAvailability.js`), from one setting with three positions
(Superadmin → Settings → **M-Pesa payments (STK)**; owner, 2026-11-25):

| Setting | Blocked students (Gold) | Money |
| --- | --- | --- |
| **Off** | no Pay now | — |
| **Demo** | Pay now, for every blocked student with a balance, through Safaricom's **sandbox** | none: a demo payment shows success but never touches fees, the ledger or the block |
| **Live — untested** | no Pay now | — |
| **Live — tested** | Pay now, with the school's live keys | real: posted to the ledger once, the block clears at zero |

In every position, these must also hold: the `payments.daraja` feature flag
is on, and the school's plan includes `mpesaStk` (Gold) and isn't locked or
expired.

When Pay now isn't offered, a blocked student sees only the manual route: pay
to the till or paybill, paste the whole M-PESA message, and the teacher
approves. `/api/payments/initiate` refuses with the reason (`mpesa_off`,
`mpesa_offline`, `payments_unavailable`, …). It never sends a push the screen
wouldn't offer.

## Demo: showing how it works

Choose **Demo**. Every blocked Gold student with a balance sees Pay now, with
a note before paying: "Demo: this doesn't pay your fees. Pay your teacher as
usual." The push uses the server's sandbox keys (`DARAJA_SANDBOX_*`) whatever
else is set; on Safaricom's sandbox the test phone gets the prompt, and the
screen shows the demo success.

A demo payment is kept apart (`mpesa/demo`), never in `mpesa/transactions`,
so nothing that posts money (the callback's payment path, the reconcile sweep)
ever sees it. The student stays blocked and the balance is unchanged.

## Live: turning it on for a school

1. **Safaricom first.** Going live needs Safaricom's approval of the
   production app for the school's till or paybill (Go-Live), which can take
   days. Start that before anything else. `PUBLIC_BASE_URL` must be the HTTPS
   site address, because the callback URL is built from it.
2. **Superadmin → Settings → M-Pesa payments (STK):**
   1. **Choose Live.** With no live keys, the keys form appears. The badge
      says **Live — untested**, and students don't see Pay now.
   2. **Enter the school's keys:** consumer key, consumer secret, passkey, the
      till or paybill number, and the type. A wrong type means the prompt
      never reaches the phone.
      - They are stored encrypted (`APP_ENCRYPTION_KEY`) and never shown
        again: only the last 4 characters.
      - They can be replaced or removed there. Without saved keys, the
        server's `DARAJA_LIVE_*` keys are used if set.
   3. **Send test payment (KES 1)** to a phone you hold, and approve it on the
      phone.
      - When M-Pesa confirms, the card shows **Live — tested**, and Pay now
        appears for blocked students with a balance.
      - If Safaricom's callback doesn't arrive, the card asks Safaricom's
        status query after 20 seconds.
      - With no answer in 2 minutes, it shows a timeout. Try again.
3. **Changing the keys makes it Live — untested** until a new test passes.
   "Tested" belongs to the keys: the confirmed test records a fingerprint (a
   hash, never the values) of the live keys, and Live counts as tested only
   while the keys in use still match it. Saving, replacing or removing keys,
   or changing the server's `DARAJA_LIVE_*`, all break the match. Switching to
   Off or Demo and back to Live keeps it tested.

The test push is kept apart from real payments (`mpesa/tests`, never
`mpesa/transactions`), so it is never posted to any ledger. It runs only on
Live, with the live keys.

`DARAJA_MODE` no longer decides which keys STK uses: the setting does (Demo →
sandbox, Live → production).

## Switching it off

Choose **Off** on the same card. Pay now disappears everywhere (within the
bootstrap cache: about a minute), and new payments are refused. Live payments
already made are still received: the callback and the reconcile sweep accept
them, each with the keys of the environment it was made in, so money is never
stranded.

## The student flow (unchanged since Phase 09)

- **The amount** comes from the server balance (a partial amount is allowed,
  never more than the balance).
- **The status** is polled.
- **The ledger** is posted once, even when Safaricom repeats the callback.
- **The fee block** clears when the balance reaches zero.
- **A reconcile sweep** every 10 minutes recovers payments whose callback was
  lost.

## History

- **October 2026 (pilot):** the panel was commented out (three blocks marked
  "STK" in `BlockedStudentScreen.jsx`), and the keys could only come from the
  environment.
- **Release F (013Fixes, phases 29–31):** owner answer 5 replaced both:
  - the school's keys are saved on the superadmin page;
  - a switch and a confirmed KES 1 test control availability;
  - the panel is back in the code.
- **Release F (013Fixes, phase 30b, owner 2026-11-25):** the switch became
  Off / Demo / Live. Demo shows the whole flow through the sandbox without
  touching fees; "tested" is tied to the live keys' fingerprint.
