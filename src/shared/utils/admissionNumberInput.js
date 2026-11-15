/**
 * What a student typed into the number field — 008Fixes / 04: "0042" is an
 * admission number; "S-0042", "s0042" and "S 0042" are a staff number.
 * Spaces around are ignored. Returns { kind: 'student' | 'staff', digits } or
 * null. Re-exported by admissionNumber.js; the API copy keeps it inline
 * (tests/unit/fixes008/admissionNumberRule.test.js checks they agree).
 */
export function parseNumberInput(raw) {
  const match = /^(s[\s-]?)?(\d{4})$/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  return { kind: match[1] ? 'staff' : 'student', digits: match[2] };
}
