import { countries } from '@/shared/constants/countries';

/**
 * A phone number as the check-in steps show it back — 012Fixes / 00 (ported in 014Fixes / 03):
 *
 *   +254712345877  →  07•• ••• 877     (Kenyan numbers, as students know them)
 *   +256712345877  →  +256 •• ••• 877  (other countries: the code, the end)
 *
 * Never more than the last 3 digits of the number (the Kenyan network prefix
 * "07" / "01" aside), and never throws: anything too short or odd is "•••".
 */

const HIDDEN = '•• •••';
// Longest code first, so +254 wins over a shorter code that starts the same.
const DIALS = [...new Set(countries.map((c) => c.dial))].sort((a, b) => b.length - a.length);

export function maskPhone(value) {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return '•••';
  const tail = digits.slice(-3);

  let local = null;
  if (/^254\d{9}$/.test(digits)) local = digits.slice(3);
  else if (/^0\d{9}$/.test(digits) && !raw.startsWith('+')) local = digits.slice(1);
  if (local) return `0${local[0]}•• ••• ${tail}`;

  if (raw.startsWith('+')) {
    // The country code, when the rest is still long enough to hide something.
    const dial = DIALS.find((d) => digits.startsWith(d.slice(1)) && digits.length - (d.length - 1) >= 6);
    if (dial) return `${dial} ${HIDDEN} ${tail}`;
  }
  return `${HIDDEN} ${tail}`;
}
