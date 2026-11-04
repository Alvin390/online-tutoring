/**
 * The amount an M-Pesa message says was paid — 006Fixes / 06–07. Shown as a
 * hint when approving a receipt, and used to prefill a partial amount. Only a
 * hint: the teacher confirms the figure, and the server records what is sent.
 *
 *   "Ksh1,200.00 paid to …"  -> 1200
 *   "KSH. 2,750 paid to …"   -> 2750
 *   "Focus online staff"     -> null
 */
const KES_AMOUNT = /\b(?:ksh|kes)\.?\s*([\d,]+(?:\.\d{1,2})?)/i;

export function receiptKes(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(KES_AMOUNT);
  if (!match) return null;
  const value = Math.floor(Number(match[1].replace(/,/g, '')));
  return Number.isFinite(value) && value > 0 ? value : null;
}
