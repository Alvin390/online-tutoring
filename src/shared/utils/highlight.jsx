/**
 * Search-term highlighting — Phase 05 Part B.
 *
 * Returns an array of React nodes, splitting on the match and wrapping hits in
 * <mark>. It never builds an HTML string and never touches
 * `dangerouslySetInnerHTML`.
 *
 * That matters here specifically: note bodies are free text typed by the
 * teacher and rendered back into the dashboard. Injecting them as HTML to add
 * a highlight would turn the one field in the app designed to hold arbitrary
 * prose into a stored-XSS sink. React's default text-node escaping is the whole
 * defence, and this preserves it.
 */

/** Escapes regex metacharacters so a search for "C++" or "(a)" cannot throw. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlight(text, term) {
  const source = String(text ?? '');
  const needle = String(term ?? '').trim();

  // Nothing to split, or nothing to split on: return the plain string so the
  // return type is a bare string whenever no highlighting happened.
  if (!source || !needle) return source;

  let pattern;
  try {
    pattern = new RegExp(`(${escapeRegExp(needle)})`, 'gi');
  } catch {
    return source;
  }

  const parts = source.split(pattern);

  return parts.map((part, index) =>
    // split() with a capture group puts matches at odd indices.
    index % 2 === 1 ? (
      // eslint-disable-next-line react/no-array-index-key
      <mark key={index} className="px-0">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export { escapeRegExp };
