/**
 * Approved wording with **…** in bold (012Fixes / 00's `Rich`, ported in
 * 014Fixes / 04). Plain text otherwise: never HTML.
 */
export default function Rich({ text }) {
  const parts = String(text ?? '').split(/\*\*(.+?)\*\*/g);
  // Odd parts are the ones that were between ** and **.
  return <>{parts.map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}</>;
}
