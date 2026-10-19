/**
 * Report constants shared by the teacher form and the superadmin inbox —
 * Phase 13 / 06. The server holds its own copy (api/_lib/reports.js and
 * api/reports/attachment.js); tests/unit/phase13/reports.test.jsx asserts the
 * two agree, the same arrangement as the session and student-state helpers.
 */

export const MAX_ATTACHMENTS = 3;

/** Server cap per image AFTER compression — what fits a 256 KB JSON body. */
export const MAX_FULL_BYTES = 185_000;
export const MAX_THUMB_BYTES = 40_000;

/** What a teacher may pick before compression. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const SEVERITIES = [
  { id: 'blocking', label: 'Blocking', hint: 'I cannot teach or students cannot join', icon: 'bi-exclamation-octagon' },
  { id: 'annoying', label: 'Annoying', hint: 'It works, but badly or slowly', icon: 'bi-exclamation-triangle' },
  { id: 'cosmetic', label: 'Cosmetic', hint: 'Something looks wrong', icon: 'bi-brush' },
];

export const URGENCIES = [
  { id: 'soon', label: 'Soon — it would help me now' },
  { id: 'whenever', label: 'Whenever convenient' },
];

export const BUG_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved', 'wont_fix'];
export const FEATURE_STATUSES = ['new', 'reviewing', 'quoted', 'accepted', 'declined', 'shipped'];
export const statusesFor = (type) => (type === 'bug' ? BUG_STATUSES : FEATURE_STATUSES);

export const STATUS_LABELS = {
  new: 'New',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
  reviewing: 'Reviewing',
  quoted: 'Quoted',
  accepted: 'Accepted',
  declined: 'Declined',
  shipped: 'Shipped',
};

export const STATUS_TONE = {
  new: 'primary',
  acknowledged: 'info',
  in_progress: 'warning',
  resolved: 'success',
  wont_fix: 'secondary',
  reviewing: 'info',
  quoted: 'warning',
  accepted: 'success',
  declined: 'secondary',
  shipped: 'success',
};

/** The disclaimers — wording from the phase 06 plan, D6. */
export const DISCLAIMERS = {
  bug: 'Thank you for telling us — every report makes the platform better for you and your students. We\'ll get back to you within 36 hours at the very most, and usually much sooner.',
  feature: 'We love hearing what would make your teaching easier! New features are custom work, so each one carries an extra cost — we\'ll send you a clear quote before anything begins, and you\'ll hear back from us within 3 working days.',
};

/** "Sat 18 Oct" in Nairobi time — the reply-by date shown after sending. */
export function formatDueDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi',
  }).format(new Date(iso));
}
