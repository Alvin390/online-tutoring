/**
 * Class-link parsing and validation — Phase 04 Part B.
 *
 * Replaces `zoomLink.includes('zoom.us')`, which passed for
 * `https://evil.com/?x=zoom.us`. Since the result was fed straight to
 * `window.location.href`, that substring check was an open redirect, not merely
 * weak validation.
 *
 * The rules here, in order of importance:
 *   1. Parse as a URL. If it does not parse, it is not a link.
 *   2. Require https. An http class link downgrades every student's session.
 *   3. Compare the HOSTNAME against an exact-match allowlist. Never a
 *      substring, never `endsWith` (which `notzoom.us` would satisfy), never
 *      `includes`.
 *   4. Return the RE-SERIALISED url. Storing `url.toString()` rather than the
 *      raw input normalises it and guarantees whatever is stored is what was
 *      actually validated.
 *
 * This function runs in three places: the teacher's input (inline feedback),
 * the serverless save handler, and — in simplified form — firestore.rules.
 * The client copy is UX; the server copy is the control.
 */

const PROVIDERS = {
  zoom: {
    label: 'Zoom',
    icon: 'bi-camera-video-fill',
    // Any Zoom subdomain (us02web, eu01web, a vanity name), or bare zoom.us.
    patterns: [/^([a-z0-9-]+\.)?zoom\.us$/i],
    example: 'https://us02web.zoom.us/j/1234567890?pwd=…',
  },
  meet: {
    label: 'Google Meet',
    icon: 'bi-camera-video',
    patterns: [/^meet\.google\.com$/i],
    example: 'https://meet.google.com/abc-defg-hij',
  },
};

export const PROVIDER_META = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, icon: p.icon, example: p.example }])
);

/**
 * @param {string} raw
 * @returns {{valid: true, provider: 'zoom'|'meet', url: string}
 *          |{valid: false, error: string}}
 */
export function parseClassLink(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, error: 'Please paste a class link.' };
  }

  const trimmed = raw.trim();

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, error: 'That is not a valid link. Paste the full address, starting with https://' };
  }

  // Checked explicitly rather than relying on the allowlist, so that
  // `javascript:`, `data:` and `http:` all fail with an accurate message.
  if (url.protocol !== 'https:') {
    return { valid: false, error: 'The link must start with https://' };
  }

  for (const [provider, config] of Object.entries(PROVIDERS)) {
    if (config.patterns.some((pattern) => pattern.test(url.hostname))) {
      return { valid: true, provider, url: url.toString() };
    }
  }

  return {
    valid: false,
    error: 'Only Zoom and Google Meet links are supported.',
  };
}

/** Provider of an already-stored link, or null. Never throws. */
export function detectProvider(url) {
  const result = parseClassLink(url);
  return result.valid ? result.provider : null;
}

export function providerLabel(provider) {
  return PROVIDERS[provider]?.label ?? 'your class';
}

export { PROVIDERS };
