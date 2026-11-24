import { FieldValue } from './firebaseAdmin.js';
import { ApiError } from './errors.js';
import { numberProblem, reservationId } from './admissionNumber.js';

/**
 * Giving a number — 014Fixes / 00 (owner, 2026-11-24).
 *
 * Students no longer choose: once their phone is confirmed, the school gives
 * them a random 4-digit number (staff: a staff number), never an easy one,
 * unique in the session. Anyone who chose one before keeps it.
 *
 * Inside the caller's transaction: a round of candidates is read in ONE
 * batchGet (the shim coalesces reads in the same tick), the first free one is
 * reserved with tx.create, so two records racing for the same number cannot
 * both hold it (the loser's transaction retries with fresh candidates). A
 * session would need thousands of numbers before a round came back full.
 */

export const CANDIDATES_PER_ROUND = 12;
const ROUNDS = 3;
const SPACE = 10_000;

// Web Crypto (Workers and Node alike). The modulo favours some numbers by
// about 1 in 430,000: irrelevant for an admission number.
const cryptoRandom = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % SPACE;

/** `count` distinct 4-digit strings, none easy. `random()` gives an integer in [0, 9999]. */
export function numberCandidates(count = CANDIDATES_PER_ROUND, random = cryptoRandom) {
  const picked = new Set();
  for (let draws = 0; picked.size < count && draws < count * 50; draws += 1) {
    const value = String(random()).padStart(4, '0');
    if (!numberProblem(value)) picked.add(value);
  }
  return [...picked];
}

export function numbersBusy() {
  return new ApiError(503, 'numbers_busy', 'Please try again in a moment.');
}

/**
 * Reserves a free number for `phone` and returns its digits. All of the
 * caller's own reads must be done before this (it reads, then writes). The
 * record itself is the caller's to write (it knows create vs update).
 */
export async function reserveGivenNumber(tx, db, { session, phone, kind, random }) {
  for (let round = 0; round < ROUNDS; round += 1) {
    const candidates = numberCandidates(CANDIDATES_PER_ROUND, random);
    const refs = candidates.map((digits) => db.doc(`sessions/${session}/numbers/${reservationId(kind, digits)}`));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const free = snaps.findIndex((snap) => !snap.exists);
    if (free !== -1) {
      tx.create(refs[free], { phone, kind, number: candidates[free], given: true, at: FieldValue.serverTimestamp() });
      return candidates[free];
    }
  }
  throw numbersBusy();
}
