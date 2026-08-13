/**
 * Money — Phase 06.
 *
 * ALL MONEY IN THIS SYSTEM IS AN INTEGER NUMBER OF KENYAN SHILLINGS.
 *
 * Not cents, not floats. Kenyan tutoring fees are quoted in whole shillings
 * ("Grade 8: KES 3,000"), nobody bills 3,000.50, and every float in a money
 * path is a rounding bug waiting for a large enough ledger. `0.1 + 0.2` is
 * 0.30000000000000004, and a balance that drifts by a cent per posting becomes
 * a dispute with a parent that we cannot win because we cannot explain it.
 *
 * There are exactly two places where a non-integer enters the system, and both
 * convert here, once:
 *
 *   1. Paystack works in the currency SUBUNIT (cents) — handled in paystack.js.
 *   2. M-Pesa Daraja returns `Amount` as a DECIMAL — `1.0`, `10500.00`
 *      (daraja_docs.txt:302). Phase 09 must call `fromDarajaAmount` and nothing
 *      else.
 */

/** Guard: throws unless the value is a safe integer number of shillings. */
export function assertIntegerKes(value, label = 'amount') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a number, got ${typeof value}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be a whole number of shillings, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is outside the safe integer range`);
  }
  return value;
}

/**
 * Converts a Daraja `Amount` to integer KES.
 *
 * Daraja types this as Decimal and sends values like `1.0` and `10500.00`
 * (daraja_docs.txt:302). Rounds rather than truncates: truncation loses money
 * belonging to the student, and a half-shilling has no meaning to reconcile
 * against anyway.
 */
export function fromDarajaAmount(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError(`Daraja amount is not a number: ${value}`);
  }
  if (n < 0) throw new RangeError(`Daraja amount cannot be negative: ${value}`);
  return Math.round(n);
}

/**
 * Normalises a Daraja phone number to the E.164 form used as our document IDs.
 *
 * Daraja sends `254722000000` — no plus sign (daraja_docs.txt:306) — while
 * every student document in this app is keyed `+254722000000`. Without this,
 * a Phase 09 callback would look up a student that appears not to exist and
 * silently drop a real payment.
 */
export function normaliseDarajaPhone(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('254')) return `+${digits}`;
  // A local 07xx/01xx number, which Daraja should not send but which turns up
  // in sandbox data.
  if (digits.startsWith('0')) return `+254${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Parses Daraja's `TransactionDate`, which is a NUMBER shaped YYYYMMDDHHmmss
 * (daraja_docs.txt:305) — not an ISO string and not epoch millis. Passing it to
 * `new Date()` yields 1970.
 */
export function parseDarajaTimestamp(value) {
  const s = String(value ?? '');
  if (!/^\d{14}$/.test(s)) return null;

  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  const minute = Number(s.slice(10, 12));
  const second = Number(s.slice(12, 14));

  // Daraja timestamps are East Africa Time (UTC+3). Kenya does not observe DST,
  // so the offset is constant and this needs no timezone database.
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - 3 * 60 * 60 * 1000;
  const date = new Date(utcMillis);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Display formatting. Never used for arithmetic. */
export function formatKes(amount) {
  const n = Number(amount) || 0;
  return `KES ${n.toLocaleString('en-KE')}`;
}

/**
 * Signed amount for a ledger entry.
 *
 * The sign convention is the whole basis of the running balance, so it is
 * defined once, here, rather than at each call site:
 *
 *   invoice     POSITIVE — increases what the student owes
 *   payment     NEGATIVE — decreases it
 *   adjustment  either   — a manual correction, signed by the teacher's intent
 *   reversal    opposite of the entry it reverses
 */
export const LEDGER_SIGN = {
  invoice: 1,
  payment: -1,
  adjustment: 1,
  reversal: 1,
};

export function signedAmount(type, magnitude) {
  assertIntegerKes(magnitude, 'amount');
  if (magnitude < 0) {
    throw new RangeError('Pass a positive magnitude; the entry type decides the sign.');
  }
  const sign = LEDGER_SIGN[type];
  if (sign === undefined) throw new TypeError(`Unknown ledger entry type: ${type}`);
  return magnitude * sign;
}
