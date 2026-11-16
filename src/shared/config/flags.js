/**
 * Feature flags — Phase 01 D6.
 *
 * Backed by a single `config/flags` document, read once at boot and cached in
 * context. Boolean only: there is one teacher per deployment, so a percentage
 * rollout has nothing to roll out to.
 *
 * Every phase from 04 onward ships behind a flag, and every flag carries a
 * removal criterion in its phase file. A flag without a removal criterion
 * becomes permanent branching, which is worse than the risk it was hedging.
 */

export const DEFAULT_FLAGS = {
  // --- Phase 02 ---
  /** Role/tier claims drive route gating. Off = the old signed-in boolean. */
  'auth.roles': false,
  /** Student phone+OTP identity. Off = phone-only check-in. */
  'auth.studentIdentity': false,
  /**
   * Serve a student their own record through /api/student/checkin without a
   * verified phone claim.
   *
   * REMOVAL CRITERION: every active student has verified once, or 60 days
   * after launch, whichever comes first. Must stay ON while
   * auth.studentIdentity is OFF, or existing students cannot check in at all.
   */
  'auth.legacyStudentRead': true,

  // --- Phase 03 ---
  /** Subscription gating. Off = full access, pre-upgrade behaviour. */
  'billing.enabled': false,

  // --- Phase 04 ---
  'registration.requireApproval': false,
  'links.googleMeet': false,

  // --- Phase 05+ ---
  'sessions.teacherDefined': false,
  'notes.enabled': false,
  'fees.enabled': false,
  'calendar.enabled': false,
  'whatsapp.broadcast': false,
  'whatsapp.advanced': false,

  // --- Phase 09 ---
  /**
   * In-app M-Pesa payments.
   *
   * NOTE: turning this OFF hides the Pay-now button and refuses new
   * initiations, but the CALLBACK endpoint stays live regardless — an
   * in-flight payment must still be able to land, and disabling it would
   * silently lose real money that a parent has already been charged.
   */
  'payments.daraja': false,

  // --- 008Fixes ---
  /**
   * Check-in by admission number + phone, with the phone confirmed once by an
   * SMS code and one device per class (008Fixes Release A). Off: check-in is
   * phone-only, exactly as before — the instant rollback if class time goes
   * wrong. Numbers already chosen are kept either way.
   */
  'checkin.admissionNumbers': false,
  /**
   * SMS to parents and staff through HashBack (008Fixes Release B): the new
   * Messages composer, the staff SMS button and the superadmin cost card.
   * Off: messaging is the WhatsApp composer as before.
   */
  'sms.enabled': false,
  /**
   * 009Fixes (owner, 2026-11-16), with admission numbers on: a new student
   * confirms the phone BEFORE the registration is saved (code-first), and a
   * student whose phone was never confirmed can move their record ONCE to
   * their real number (found by the number they registered with, or by name
   * and class). Off: registration saves first and confirms after, as before.
   */
  'student.fixNumber': false,
};

export const FLAG_KEYS = Object.freeze(Object.keys(DEFAULT_FLAGS));

/**
 * Merges a remote flags document over the defaults.
 *
 * Unknown remote keys are dropped rather than passed through — the flag set is
 * defined by the code that reads it, not by whatever happens to be in the
 * document. That stops a stale or hand-edited document from resurrecting a
 * flag whose branch has already been deleted.
 */
export function resolveFlags(remote) {
  const resolved = { ...DEFAULT_FLAGS };
  if (!remote || typeof remote !== 'object') return resolved;

  for (const key of FLAG_KEYS) {
    if (typeof remote[key] === 'boolean') resolved[key] = remote[key];
  }
  return resolved;
}

export function isEnabled(flags, key) {
  return (flags ?? DEFAULT_FLAGS)[key] === true;
}
