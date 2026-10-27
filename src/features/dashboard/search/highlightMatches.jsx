/**
 * Highlighting for student search — 001Fixes / 04.
 *
 * Search matching folds case, accents and apostrophes ("zoe" finds "Zoë",
 * "obri" finds "O'Brien"), so the highlight must fold the same way and then
 * map the match back onto the original characters. Like @utils/highlight it
 * returns React nodes — text stays text, so a name can never inject markup.
 */

const DIACRITICS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`]/g;

/** `text` folded like the search, plus, for each folded char, its original index. */
function fold(text) {
  let folded = '';
  const origin = [];
  for (let i = 0; i < text.length; i += 1) {
    const out = text[i].normalize('NFD').replace(DIACRITICS, '').toLowerCase().replace(APOSTROPHES, '');
    for (const ch of out) {
      folded += ch;
      origin.push(i);
    }
  }
  return { folded, origin };
}

/**
 * @param {unknown} text
 * @param {string[]} terms  already-normalised search terms (see highlightTerms)
 * @returns {string|Array<string|JSX.Element>}
 */
export function highlightMatches(text, terms) {
  const source = String(text ?? '');
  if (!source || !terms || terms.length === 0) return source;

  const { folded, origin } = fold(source);
  const ranges = [];
  for (const term of terms) {
    if (!term) continue;
    let at = folded.indexOf(term);
    while (at !== -1) {
      ranges.push([origin[at], origin[at + term.length - 1] + 1]);
      at = folded.indexOf(term, at + term.length);
    }
  }
  if (ranges.length === 0) return source;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const nodes = [];
  let cursor = 0;
  merged.forEach(([start, end]) => {
    if (start > cursor) nodes.push(source.slice(cursor, start));
    nodes.push(<mark key={start} className="px-0">{source.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

/**
 * The terms to highlight for a parsed query (studentSearch.parseQuery): its
 * words, the subjects short forms stand for ("maths" → "mathematics"), class
 * phrases ("f3" → "form 3"), and a phone number in the forms it is shown in.
 * One- or two-digit fragments are skipped — they would mark every number.
 */
export function highlightTerms(query) {
  const terms = new Set(query?.classPhrases ?? []);
  for (const token of query?.tokens ?? []) {
    if (token.digits && !token.phone) continue;
    terms.add(token.t);
    if (token.alias) terms.add(token.alias);
    if (token.phone) {
      if (token.t.startsWith('0')) terms.add(token.t.slice(1));
      if (token.t.startsWith('254')) terms.add(token.t.slice(3));
    }
  }
  return [...terms].filter(Boolean);
}
