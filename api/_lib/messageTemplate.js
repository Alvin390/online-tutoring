/**
 * Server copy of the message template (src/shared/utils/messageTemplate.js) —
 * 008Fixes / 07. SMS messages are filled in per parent on the server, with
 * exactly the dashboard's variables and fallbacks; a parity test keeps the
 * two renders identical. Plain strings in and out.
 */

const KES = (value) => `KES ${Number(value || 0).toLocaleString('en-KE')}`;

function formatDate(value) {
  if (!value) return '';
  const ms = typeof value === 'number'
    ? value
    : typeof value?.toMillis === 'function'
      ? value.toMillis()
      : Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The variable registry. Adding one here is all that is needed for it to appear
 * in the toolbar, resolve in the preview and validate in the composer.
 */
export const VARIABLES = [
  {
    token: 'studentName',
    label: "Student's name",
    example: 'Amina Wanjiru',
    resolve: (r) => r.studentName ?? 'the student',
  },
  {
    token: 'class',
    label: 'Class',
    example: 'Grade 8',
    resolve: (r) => r.class ?? '',
  },
  {
    token: 'balance',
    label: 'Outstanding balance',
    example: 'KES 1,500',
    resolve: (r) => KES(r.feeBalance ?? 0),
  },
  {
    token: 'dueDate',
    label: 'Next due date',
    example: '15 Mar 2026',
    resolve: (r) => formatDate(r.nextDueDate),
  },
  {
    token: 'sessionName',
    label: 'Session',
    example: 'Morning Session',
    resolve: (r) => r.sessionName ?? r.session ?? '',
  },
  // 008Fixes / 08: the school's name from the SMS setup (the shared sender
  // HASHBACKSMS does not say who is writing).
  {
    token: 'schoolName',
    label: 'School name',
    example: 'Focus Online School',
    resolve: (r) => r.schoolName ?? '',
  },
];

const REGISTRY = new Map(VARIABLES.map((v) => [v.token, v]));

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Renders a template for one recipient.
 *
 * Purely string-in, string-out — no HTML anywhere. The result goes into a
 * `wa.me` query parameter and is encoded there, so there is no markup context
 * to escape and nothing to inject into.
 */
export function renderTemplate(template, recipient = {}) {
  if (typeof template !== 'string') return '';

  return template.replace(TOKEN_PATTERN, (match, token) => {
    const variable = REGISTRY.get(token);
    // Unknown token: leave it exactly as written so the mistake is visible in
    // the preview rather than reaching a parent as "undefined".
    if (!variable) return match;
    return String(variable.resolve(recipient) ?? '');
  });
}

/** Tokens used by a template, split into known and unknown. */
export function analyseTemplate(template) {
  const used = new Set();
  const unknown = new Set();

  for (const match of String(template ?? '').matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (REGISTRY.has(token)) used.add(token);
    else unknown.add(token);
  }

  return { used: [...used], unknown: [...unknown] };
}
