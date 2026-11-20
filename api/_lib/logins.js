import { getUserByEmail } from './claims.js';
import { schoolPlan } from './schoolPlan.js';

/**
 * Dashboard logins and their seats — 013Fixes / 09.
 *
 * A seat is an ENABLED teacher login. Counted from the `users` documents
 * (role 'teacher'), where `disabled` mirrors Firebase Auth's own flag (both
 * the superadmin console and the school's logins screen write the two
 * together). A document without the field is a login made before 013Fixes
 * and counts as enabled until the release backfill writes it.
 *
 * Never counted:
 *   - the platform's developer login (config/platform.devLoginEmail, 013Fixes / 01);
 *   - the superadmin, students, and staff registered as class attendees
 *     (those are student records, not logins).
 *
 * The limit is the plan's included logins (plan + superadmin settings) plus
 * the extra logins the superadmin added for this school by hand
 * (`subscription/current.extraLogins`; no checkout exists yet).
 */

/** The developer login's uid, or null (no setting, or no such login). */
export async function devLoginUid(db) {
  const snap = await db.doc('config/platform').get();
  const email = snap.exists ? snap.data().devLoginEmail : null;
  if (typeof email !== 'string' || !email) return null;
  const user = await getUserByEmail(email.toLowerCase());
  return user?.uid ?? null;
}

/**
 * @returns {Promise<{ used: number, included: number, extra: number, limit: number,
 *   ownerUid: string|null, devUid: string|null, teachers: Array<{uid: string, disabled: boolean}> }>}
 */
export async function seatState(db) {
  const [teachersSnap, subSnap, plan, devUid] = await Promise.all([
    db.collection('users').where('role', '==', 'teacher').get(),
    db.doc('subscription/current').get(),
    schoolPlan(db),
    devLoginUid(db),
  ]);
  const sub = subSnap.exists ? subSnap.data() : {};
  const teachers = teachersSnap.docs.map((d) => ({ uid: d.id, disabled: d.data().disabled === true }));
  const used = teachers.filter((t) => !t.disabled && t.uid !== devUid).length;
  const included = plan.limits.logins;
  const extra = Number.isInteger(sub.extraLogins) && sub.extraLogins > 0 ? sub.extraLogins : 0;
  return { used, included, extra, limit: included + extra, ownerUid: sub.ownerUid ?? null, devUid, teachers };
}

/** Keep `users/{uid}.disabled` in step with Firebase Auth (written with every enable/disable). */
export async function mirrorDisabled(db, uid, disabled) {
  await db.doc(`users/${uid}`).set({ disabled: disabled === true }, { merge: true });
}
