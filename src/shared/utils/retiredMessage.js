/**
 * Dashboard copy of retiredMessage (api/_lib/duplicates.js has the server's);
 * re-exported by src/shared/utils/duplicates.js. Kept in its own module so the
 * student page loads only this (008Fixes / 06b). A parity test keeps the two
 * answers identical.
 */
/**
 * What a retired number is told (003Fixes / 12) — at check-in and when it
 * tries to register again. A merged number learns only the last 3 digits of
 * the number it was merged into.
 */
export function retiredMessage(reason, keptSuffix) {
  if (reason === 'merged') {
    return keptSuffix
      ? `This number was merged with your other registration. Please check in with your number ending …${keptSuffix}.`
      : 'This number was merged with your other registration. Please check in with your other number.';
  }
  return 'This number was registered twice. Please check in with the number you registered with first, or ask your teacher to change your number.';
}
