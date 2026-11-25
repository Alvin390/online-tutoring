# M-Pesa STK push ("Pay now"): switched on from the superadmin page

**Status (013Fixes Release F, November 2026):** the "Pay now" M-Pesa STK push
on the blocked-student screen is back in the code. It is **not** commented
out any more. Whether a student sees it is decided on the server
(`api/_lib/mpesaAvailability.js`). All of these must hold:

1. the `payments.daraja` feature flag is on;
2. the school's plan includes `mpesaStk` (Gold), and the plan isn't locked or
   expired;
3. the superadmin's **switch** is on (Superadmin → Settings → **M-Pesa
   payments (STK)**);
4. keys are set for the current mode: the school's saved **live** keys, or
   the environment's (the sandbox always uses the environment's sandbox
   keys);
5. it is **online**: Safaricom confirmed the KES 1 test push, and nothing
   changed since.

When any of these is missing, a blocked student sees only the manual route:
pay to the till or paybill, paste the whole M-PESA message, and the teacher
approves. `/api/payments/initiate` refuses with the reason (`mpesa_off`,
`mpesa_offline`, `payments_unavailable`, …). It never sends a push the screen
wouldn't offer.

## Turning it on for a school

1. **Safaricom first.** Going live needs Safaricom's approval of the
   production app for the school's till or paybill (Go-Live), which can take
   days. Start that before anything else.
2. **Live mode.** Set the Worker secret `DARAJA_MODE` to `live`
   (`npx wrangler secret put DARAJA_MODE`). This deploys a new version.
   `PUBLIC_BASE_URL` must be the HTTPS site address, because the callback URL
   is built from it.
3. **Superadmin → Settings → M-Pesa payments (STK):**
   1. **Switch it on.** In live mode with no keys, the keys form appears.
   2. **Enter the school's keys:** consumer key, consumer secret, passkey, the
      till or paybill number, and the type. A wrong type means the prompt
      never reaches the phone.
      - They are stored encrypted (`APP_ENCRYPTION_KEY`) and never shown
        again: only the last 4 characters.
      - They can be replaced or removed there.
   3. **Send test payment (KES 1)** to a phone you hold, and approve it on the
      phone.
      - When M-Pesa confirms, the card shows **Online**, and Pay now appears
        for blocked students with a balance.
      - If Safaricom's callback doesn't arrive, the card asks Safaricom's
        status query after 20 seconds.
      - With no answer in 2 minutes, it shows a timeout. Try again.
4. **Any change to the keys or the switch turns it offline** until a new test
   passes.

The test push is kept apart from real payments (`mpesa/tests`, never
`mpesa/transactions`), so it is never posted to any ledger.

## Switching it off

Turn the switch off on the same card. Pay now disappears everywhere at once
(within the bootstrap cache: about a minute), and new payments are refused.
Payments already made are still received: the callback and the reconcile
sweep accept them, so money is never stranded.

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
