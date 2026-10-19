# Gmail API setup for report emails (one time)

**Why Gmail API:** there is no domain, and the recipient must be editable from superadmin. Resend without a domain can only email its own account owner, and Cloudflare Email needs a domain on Cloudflare. Sending through a real Gmail account via Google's API gives Google-signed mail (SPF/DKIM/DMARC pass for `gmail.com`) to **any** recipient, free, within Gmail's normal daily sending limits. That is far more than reports need.

You do this once, in about 15 minutes. Bug reports and feature requests are saved whether or not this is done; only the email alert needs it.

---

## 1. Choose the sender account (recommended: a dedicated one)

Create a new Gmail account such as `onlinetutoring.alerts@gmail.com` and use it as the **sender**. The **recipient** stays `alvinmk06@gmail.com`, editable later from superadmin.

**Why separate:** Gmail files mail you send to *yourself* as already read, so it can arrive with no phone notification. Mail from a second account arrives as a normal new message and notifies. Using `alvinmk06@gmail.com` for both does work; you would just lose the alert.

## 2. Enable the Gmail API

Google Cloud Console → select **your Firebase project** (it is a Google Cloud project) → *APIs & Services → Library* → **Gmail API** → Enable.

## 3. OAuth consent screen

*APIs & Services → OAuth consent screen* (called "Google Auth Platform" in newer consoles):
- **User type:** External.
- **App name:** "Online Tutoring Alerts". Support email: yours.
- **Scopes:** add only `https://www.googleapis.com/auth/gmail.send`. It allows sending only; it cannot read mail.
- **Publishing status: set to "In production".** This matters. While an app is in "Testing", Google expires its refresh tokens after **7 days** and email would silently stop. In production, an unverified app shows a one-time "Google hasn't verified this app" screen to the sender account during step 5 (click *Advanced → Continue*). That is expected for a personal tool with one user, and no verification review is needed for that. 

## 4. Create the OAuth client

*Credentials → Create credentials → OAuth client ID → Application type: **Desktop app*** → name it "tutoring-gmail-auth".

Copy the **Client ID** and **Client secret**.

## 5. Generate the refresh token

Run:
```
npm run gmail:auth
```
(`scripts/gmailAuth.js` starts a temporary local server on `127.0.0.1`, opens Google's consent page and receives the code.)

- Sign in **as the sender account** from step 1, and approve "Send email on your behalf".
- The script prints `GMAIL_REFRESH_TOKEN=…` and sends a test email to the recipient, to prove the token works.
- The token is printed to your terminal only. It is never written to any file in the repo.

## 6. Store the secrets

Add these four lines to `.env.local` (git-ignored) and `.dev.vars`:
```
GMAIL_CLIENT_ID=…
GMAIL_CLIENT_SECRET=…
GMAIL_REFRESH_TOKEN=…
GMAIL_SENDER=onlinetutoring.alerts@gmail.com
```
Then run `npm run cf:secrets`. `pushSecrets.js` uploads every runtime variable that has a value; use `npm run cf:secrets -- --only GMAIL_REFRESH_TOKEN` (and so on) to upload just these four, because `.dev.vars` also holds local-only values. You can also `wrangler secret put` each one.

## 7. Make sure it never goes to spam (recipient side)

In `alvinmk06@gmail.com`: open any report email → ⋮ → *Filter messages like this*. Use **From:** the sender address. Then tick:
- **Never send it to Spam**
- **Always mark it as important**
- **Categorize as: Primary**

## 8. Verify

On the superadmin **Settings** tab, press **Send test email**. In the received email, open ⋮ → *Show original*. It should show **SPF: PASS, DKIM: PASS, DMARC: PASS**.

## If it ever stops working

The superadmin Settings card shows **"Gmail disconnected — reconnect"** when Google returns `invalid_grant`. That happens if:
- the sender's password is changed
- the token is revoked
- the app was left in Testing
- the token went **unused for six months**, which Google expires automatically. The app's weekly keep-alive token exchange (`notificationsSweep`) prevents this one. To fix it, re-run step 5, update `GMAIL_REFRESH_TOKEN` (step 6), then press **Resend** on any reports marked failed. No report is lost meanwhile: reports are always saved first, and email is retried.
