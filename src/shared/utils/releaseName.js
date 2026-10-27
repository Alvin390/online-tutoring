/**
 * The Sentry release name — 002Fixes / 01 and / 10.
 *
 * One function for both sides, so the release the app reports at runtime
 * (monitoring.js) and the release its source maps are uploaded to at build
 * time (vite.config.js) can never drift apart: `online-tutoring@2.0.0+5dd6570`.
 */
export function releaseName(version, commit) {
  if (!version) return undefined;
  return commit ? `online-tutoring@${version}+${commit}` : `online-tutoring@${version}`;
}
