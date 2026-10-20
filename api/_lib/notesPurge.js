import { subrequestsRemaining } from './firestoreRest.js';

/**
 * Hard-deletes student notes soft-deleted more than 30 days ago —
 * Phase 13 / 07 D4.
 *
 * The delete prompt promises "you can restore it for 30 days". Until now a
 * deleted note was never actually removed, so the promise was only half kept:
 * restorable, yes, but also retained forever — not what a teacher deleting a
 * note about a family expects.
 *
 * Runs nightly from feesSweep, BEFORE its fees-enabled gate (notes exist
 * whether or not fees are on). One collection-group query and one batched
 * delete per night — 2 subrequests for up to PURGE_BATCH notes. A purged note
 * leaves the query, so a backlog drains over successive nights with no cursor
 * to store (the same self-draining shape as mpesaReconcile).
 *
 * Index: `fieldOverrides` enables a COLLECTION_GROUP index on notes.deletedAt.
 */

export const RECOVERY_WINDOW_DAYS = 30;
export const PURGE_BATCH = 200;
const RESERVE = 3;

export async function purgeDeletedNotes(db, { now = Date.now(), log } = {}) {
  if (subrequestsRemaining() < RESERVE + 2) return { purged: 0, deferred: true };

  const cutoff = new Date(now - RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db
    .collectionGroup('notes')
    .where('deletedAt', '<', cutoff)
    .orderBy('deletedAt')
    .limit(PURGE_BATCH)
    .get();

  if (snap.docs.length === 0) return { purged: 0, more: false };

  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();

  log?.info?.('Purged notes past the recovery window', { purged: snap.docs.length });
  return { purged: snap.docs.length, more: snap.docs.length === PURGE_BATCH };
}
