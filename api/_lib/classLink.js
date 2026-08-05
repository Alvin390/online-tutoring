/**
 * Server copy of class-link validation — Phase 04 Part B.
 *
 * A deliberate duplicate of src/shared/utils/classLink.js, for the same reason
 * as api/_lib/log.js: `/api` is a separate build target with no Vite alias
 * resolution, and coupling the serverless bundle to the client bundle buys
 * nothing.
 *
 * THIS copy is the control. The client copy is inline feedback for the teacher
 * while they type — helpful, and completely bypassable.
 *
 * A parity test asserts the two agree on every case in the suite. If you change
 * a pattern here, change it there.
 */

const PROVIDERS = {
  zoom: [/^([a-z0-9-]+\.)?zoom\.us$/i],
  meet: [/^meet\.google\.com$/i],
};

export function parseClassLink(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'Please paste a class link.' };
  }

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { valid: false, error: 'That is not a valid link. Paste the full address, starting with https://' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, error: 'The link must start with https://' };
  }

  for (const [provider, patterns] of Object.entries(PROVIDERS)) {
    if (patterns.some((pattern) => pattern.test(url.hostname))) {
      return { valid: true, provider, url: url.toString() };
    }
  }

  return { valid: false, error: 'Only Zoom and Google Meet links are supported.' };
}

export function detectProvider(url) {
  const result = parseClassLink(url);
  return result.valid ? result.provider : null;
}
