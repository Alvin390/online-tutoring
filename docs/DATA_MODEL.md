# Data model (Firestore)

The live shape of the data, taken from `firestore.rules` and the API code (`api/`).
Every write goes through the Worker API unless the rules column says otherwise;
the API uses the service account, so the rules mainly decide what the **browser**
may read directly.

Conventions:

- **Phone numbers are document IDs** in E.164 form (`+254711000001`).
- **Money is integer minor units** (cents), never floats. See `api/_lib/money.js`.
- **`.../items/{id}`**: collections that live under a fixed document
  (`fees/accounts/items/{phone}`) keep one path convention across features.
- **Timestamps** are Firestore timestamps written by the server.

---

## Sessions and students

### `sessions/{slug}`
A class session (`morning`, `evening`, or one the teacher created).

| Field | Notes |
|---|---|
| `name`, `slug`, `description` | `description` ≤ 160 characters |
| `icon`, `gradient` | homepage / session card styling |
| `order` | homepage order |
| `active` | `false` hides the session and refuses new registrations |
| `schedule` | `{ days, startTime, endTime, tz }`, or `null`; `tz` is `Africa/Nairobi` |
| `classes` | ordered list the registration form offers (1–30 classes, each up to 60 characters). **Absent → `DEFAULT_CLASSES`** (Form One…Form Four) |
| `createdAt`, `updatedAt` | |

Rules: `isValidSessionDoc` allows exactly these keys. Public pages read sessions
through `GET /api/public/bootstrap`, not the client SDK.

### `sessions/{slug}/private/classLink`
The class (Zoom / Google Meet) link. Served by `/api/class/link` only to an
admitted, unblocked student. It is never readable from a public page.

### `sessions/{slug}/students/{phone}`
One registration.

| Field | Notes |
|---|---|
| `studentName`, `parentPhone`, `class`, `subjects`, `receiptMessage` | from the registration form; `class` must be in the session's `classes` at registration time |
| `registeredAt` | |
| `approvalStatus` | `pending` / `approved` / `rejected` (when `registration.requireApproval` is on) |
| `receiptStatus` | `pending` / `approved` |
| `blocked`, `feeBalance`, `overdue`, `nextDueDate` | access and fee state, derived by the ledger |

Created by `POST /api/student/register`. The rules' create path for the old
client is still open until the release follow-up removes it (`docs/LAUNCH.md`,
"Release follow-ups").

### `sessions/{slug}/students/{phone}/notes/{noteId}`
Teacher notes about a student. Purged by `api/_lib/notesPurge.js` when the student is removed.

### `sessions/{slug}/students/{phone}/meta/activity`
`{ lastAccessed }`, written on student check-in. It is kept off the student
document so a check-in does not re-render every teacher dashboard listening to it.

---

## Fees (Silver and Gold)

The ledger is **append-only**. A mistake is corrected with a `reversal` entry,
never by editing or deleting. See `api/_lib/ledger.js`.

| Path | Contents |
|---|---|
| `fees/config` | teacher's fee settings |
| `fees/accounts/items/{phone}` | denormalised account summary (balance) |
| `fees/accounts/items/{phone}/ledger/{entryId}` | entries: `type` (`invoice` / `payment` / `adjustment` / `reversal`), `amount`, `method` (`cash` / `mpesa` / `bank` / `platform`), `note` |
| `fees/invoices/items/{invoiceId}` | issued invoices |
| `fees/counters/items/{name}` | transactional sequence numbers |

### M-Pesa (Gold)

| Path | Contents |
|---|---|
| `integrations/daraja` | `callbackSecret`, the secret path segment of the Daraja callback URL. Credentials come only from environment variables, never from Firestore |
| `mpesa/transactions/items/{checkoutRequestId}` | one STK push and its outcome |
| `mpesa/unmatched/items/{checkoutRequestId}` | callbacks that matched no pending push |

All of these are server-only (`allow read, write: if false`).

---

## Teacher plan and billing

### `subscription/current`
The teacher's plan.

| Field | Notes |
|---|---|
| `tier` | `bronze` / `silver` / `gold`; M-Pesa needs `gold` |
| `status`, `currentPeriodEnd`, `renewalMode` | `renewalMode`: `manual` or card |
| `ownerUid` | the paying teacher's uid. The webhook sets it, and `subscriptionSweep` backfills it when exactly one teacher exists |
| `scheduledTierChange` | a downgrade scheduled for the end of the period: `{ tier, effectiveAt, newSubscriptionCode, newEmailToken, confirmedByPaystack }` |
| `paystack*` | Paystack customer, subscription, plan and authorization codes |

### `subscription/public`
The subset a signed-in teacher may read (`allow get: if isTeacher()`).

### `billing/**`
Paystack events and checkouts. Server-only.

---

## Reports (bug reports and feature requests)

### `reports/{id}`

| Field | Notes |
|---|---|
| `type` | `bug` or `feature` |
| `title`, `description` | plus `steps`, `expected`, `severity` (bug) or `problem` (feature) |
| `attachments[]` | `{ path, thumbPath, contentType, bytes, width, … }` |
| `context` | page, tier, flags at submit time |
| `submittedBy` | `{ uid, email, displayName }` |
| `status`, `responseDueAt` | workflow in the superadmin inbox |
| `email` | `{ status: sent / failed / needs_attention, attempts, sentAt, gmailId, recipient, lastError, nextAttemptAt }`; retried by `notificationsSweep` |

Also server-only:

- `reportUploads/{id}`: staging for attachments.
- `counters/reports`: report numbers (`BUG-…`, `FR-…`).

### `config/notifications`
`{ reportRecipient, updatedAt, updatedBy }`. It is created with the default
recipient on first read, and the superadmin edits it. Server-only.

---

## Configuration, auth, operations

| Path | Contents |
|---|---|
| `config/flags` | feature flags (`{ "fees.enabled": true, … }`); world-readable, superadmin-writable |
| `config/zoomLinks` | **legacy** class links, read only as a fallback until the release follow-up removes it |
| `config/sessionsBootstrap` | run-once marker for creating `morning`/`evening`. Its existence is also what keeps a deleted default session deleted |
| `users/{uid}` | staff profile and role |
| `admin/**` | superadmin data |
| `audit/{id}` | `{ action, actor, target, before, after, context }`, written by every mutation (`api/_lib/audit.js`) |
| `aggregates/dashboard` | dashboard counters |
| `calendar/events/items/{id}`, `calendar/tokens/items/{sha256}` | calendar events; hashed calendar-feed tokens |
| `whatsapp/campaigns/items/{id}` (+ `recipients/{phone}`) | WhatsApp broadcasts |
| `rateLimits/**`, `otp/**`, `loginAttempts/**` | rate limiting, student OTPs, staff login throttling. Server-only |

---

## Indexes

`firestore.indexes.json` is the source of truth. Collection-group indexes on
`students` back the cross-session dashboard queries; `reports` indexes back the
superadmin inboxes. The indexes deploy separately from the Worker:

```bash
npx firebase-tools deploy --only firestore:indexes --project online-tutoring-6d71a
```

A query whose index is missing fails at runtime with `FAILED_PRECONDITION … requires an index`.
