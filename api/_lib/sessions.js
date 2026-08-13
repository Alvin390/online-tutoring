/**
 * Session slug rules — server copy. Phase 05 Part A.
 *
 * Duplicated from src/shared/constants/sessions.js for the usual reason: `/api`
 * is a separate build target. A parity test asserts the two lists agree, so a
 * slug reserved in the UI cannot be accepted by the API.
 */

export const RESERVED_SLUGS = Object.freeze([
  'login', 'logout', 'dashboard', 'billing', 'superadmin', 'admin',
  '403', '404',
  'api', 'assets', 'static', 'sw', 'workbox', 'manifest', 'robots', 'favicon',
  'fees', 'calendar', 'whatsapp', 'settings', 'account', 'help',
]);

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function validateSlug(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'Please enter a web address for this session.' };
  }

  const slug = raw.trim().toLowerCase();

  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      error:
        'Use 1–40 lowercase letters, numbers and hyphens. It cannot start or end with a hyphen.',
    };
  }

  if (RESERVED_SLUGS.includes(slug)) {
    return { valid: false, error: `"${slug}" is reserved by the app. Please choose another.` };
  }

  return { valid: true, slug };
}

/**
 * Recursively deletes a document and everything beneath it.
 *
 * FIRESTORE DOES NOT CASCADE. Deleting `sessions/x/students/y` leaves
 * `sessions/x/students/y/notes/*` orphaned but fully intact — still readable by
 * anyone with the path, still counted in collection-group queries, and
 * invisible in the console because the parent is gone. For private teacher
 * notes about a student who has been removed, that is a data-protection problem
 * as well as a correctness one.
 *
 * `recursiveDelete` on the Admin SDK handles this; the loop below is the
 * fallback for environments where the bulk writer is unavailable.
 */
export async function deleteRecursively(db, ref) {
  if (typeof db.recursiveDelete === 'function') {
    await db.recursiveDelete(ref);
    return;
  }

  const subcollections = await ref.listCollections();
  for (const collection of subcollections) {
    // eslint-disable-next-line no-await-in-loop
    const docs = await collection.listDocuments();
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(docs.map((doc) => deleteRecursively(db, doc)));
  }
  await ref.delete();
}
