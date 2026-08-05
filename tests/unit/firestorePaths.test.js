import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Firestore path parity — added in Phase 09 after a real bug.
 *
 * A Firestore DOCUMENT path must have an EVEN number of segments and a
 * COLLECTION path an ODD number. `db.doc('mpesa/transactions/abc')` is three
 * segments and throws at runtime — but only when that line executes, which for
 * a payment callback means the first time a parent actually pays.
 *
 * Appendix A specifies several paths in the odd/even-wrong form
 * (`mpesa/transactions/{id}`, `fees/students/{phone}`). Both were caught by
 * reading, one in Phase 06 and one in Phase 09. This test catches the next one
 * automatically, because reading is not a reliable control.
 *
 * It scans the real source rather than testing a helper, so it cannot be
 * satisfied by a mock.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..', '..', 'api');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Extracts the literal part of a template path, replacing `${...}` with a
 * single placeholder segment. A path is only checkable when the interpolations
 * sit inside one segment each, which is the case throughout this codebase.
 */
function segmentCount(literal) {
  return literal
    .replace(/\$\{[^}]*\}/g, 'X')
    .split('/')
    .filter(Boolean).length;
}

const DOC_CALL = /\.doc\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;
const COLLECTION_CALL = /\.collection\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g;

describe('Firestore path segment parity across api/', () => {
  const files = walk(apiRoot);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every .doc() path has an EVEN segment count', () => {
    const offenders = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(DOC_CALL)) {
        const path = match[1];
        // A single-segment argument is a document ID relative to a collection
        // reference (`collection.doc(id)`), which is always valid.
        const count = segmentCount(path);
        if (count === 1) continue;
        if (count % 2 !== 0) {
          offenders.push(`${file.replace(apiRoot, 'api')}: .doc('${path}') → ${count} segments`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every .collection() path has an ODD segment count', () => {
    const offenders = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(COLLECTION_CALL)) {
        const path = match[1];
        const count = segmentCount(path);
        if (count % 2 === 0) {
          offenders.push(
            `${file.replace(apiRoot, 'api')}: .collection('${path}') → ${count} segments`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the specific paths that were wrong', () => {
  it('mpesa transactions use the four-segment items form', () => {
    const initiate = readFileSync(join(apiRoot, 'payments', 'initiate.js'), 'utf8');
    expect(initiate).toContain('mpesa/transactions/items/');
    expect(initiate).not.toMatch(/doc\(`mpesa\/transactions\/\$\{/);
  });

  it('fee accounts use the four-segment items form', () => {
    const ledger = readFileSync(join(apiRoot, '_lib', 'ledger.js'), 'utf8');
    expect(ledger).toContain('fees/accounts/items/');
  });
});
