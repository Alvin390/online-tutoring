/**
 * Message templating — Phase 08 D3.
 *
 * `{{studentName}}`, `{{class}}`, `{{balance}}`, `{{dueDate}}`,
 * `{{sessionName}}`, resolved per recipient.
 *
 * `{{balance}}` is why this phase depends on Phase 06. "Dear parent, the
 * balance for {{studentName}} is KES {{balance}}, due {{dueDate}}" is the
 * single highest-value message a tutor sends, and it is only possible once a
 * ledger exists.
 *
 * Two rules that keep this from producing embarrassing messages:
 *
 *   - An UNKNOWN variable is left verbatim, never replaced with "undefined".
 *     A parent receiving "Dear undefined" is worse than one receiving
 *     "{{parentName}}", because the second is obviously a mistake the teacher
 *     can see in the preview.
 *   - A KNOWN variable with a missing value falls back to something readable,
 *     per variable — an absent balance becomes "0", not blank.
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

/**
 * Appends attachment links to the message body.
 *
 * This is the workaround for constraint 1 in waLink.js — a file can never be
 * pre-attached to a `wa.me` link, so the download URL rides in the text. The
 * filename and size are included because a student deserves to know what they
 * are tapping before they tap it on a metered connection.
 */
export function appendAttachments(message, attachments = []) {
  if (!attachments.length) return message;

  const lines = attachments.map((attachment) => {
    const size = attachment.sizeBytes ? ` (${formatBytes(attachment.sizeBytes)})` : '';
    return `${attachment.filename}${size}:\n${attachment.downloadUrl}`;
  });

  return `${message}\n\n${lines.join('\n\n')}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Example render for the composer, before a real recipient is picked. */
export function previewWithExamples(template) {
  const sample = {
    studentName: 'Amina Wanjiru',
    class: 'Grade 8',
    feeBalance: 1500,
    nextDueDate: Date.parse('2026-03-15T00:00:00Z'),
    sessionName: 'Morning Session',
  };
  return renderTemplate(template, sample);
}
