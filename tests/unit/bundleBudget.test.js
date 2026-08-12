import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards for the Phase 10 performance work.
 *
 * These assert the SOURCE, not the built output, so they run without a build
 * and catch a regression at the moment someone reintroduces it — which is when
 * the reasoning is still fresh, rather than in a CI bundle report nobody reads.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

describe('jsPDF stays off the static import graph', () => {
  const source = read('src/features/dashboard/hooks/useDashboard.js');

  it('does not import jspdf at module scope', () => {
    // Statically imported, jsPDF drags in html2canvas and its canvas helpers —
    // ~220 KB gzipped on every dashboard load, for a button most teachers
    // press rarely. This single line is worth 87% of the dashboard chunk.
    expect(source).not.toMatch(/^import\s+jsPDF\s+from\s+['"]jspdf['"]/m);
    expect(source).not.toMatch(/^import\s+autoTable\s+from\s+['"]jspdf-autotable['"]/m);
  });

  it('loads it dynamically at the point of use', () => {
    expect(source).toContain("import('jspdf')");
    expect(source).toContain("import('jspdf-autotable')");
  });
});

describe('dashboard listeners are per-session, not hardcoded', () => {
  const source = read('src/features/dashboard/hooks/useDashboard.js');

  it('no longer subscribes to two literal session names', () => {
    // The Phase 05 gap: a teacher-created third session had no listener, so
    // its students never appeared on the dashboard.
    expect(source).not.toContain("subscribeToStudents('morning'");
    expect(source).not.toContain("subscribeToStudents('evening'");
  });

  it('derives the watched sessions from the session list', () => {
    expect(source).toContain('useSessions');
    expect(source).toContain('studentsBySession');
  });

  it('tears listeners down when a session goes away', () => {
    expect(source).toMatch(/unsubscribe\(\)/);
    expect(source).toContain('live.delete');
  });
});

describe('Tailwind is fully removed', () => {
  it('has no tailwind config file', () => {
    expect(existsSync(join(root, 'tailwind.config.js'))).toBe(false);
  });

  it('is not a postcss plugin', () => {
    expect(read('postcss.config.js')).not.toContain('tailwind');
  });

  it('has no @tailwind directives in the stylesheet', () => {
    // Preflight was resetting Bootstrap's base layer to support zero
    // utilities.
    expect(read('src/styles/index.css')).not.toMatch(/@tailwind\s+(base|components|utilities)/);
  });

  it('is not a dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(all.tailwindcss).toBeUndefined();
    expect(all['@tailwindcss/postcss']).toBeUndefined();
  });
});

describe('Bootstrap is imported exactly once', () => {
  it('comes from main.jsx and not also from index.css', () => {
    // It was imported in both, so the framework was being pulled in twice.
    expect(read('src/main.jsx')).toContain("import 'bootstrap/dist/css/bootstrap.min.css'");
    expect(read('src/styles/index.css')).not.toContain("@import 'bootstrap/dist/css");
  });
});

describe('Modal accessibility', () => {
  const source = read('src/shared/components/ui/Modal.jsx');

  it('declares itself a modal dialog with a labelled title', () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-labelledby');
  });

  it('handles Escape and traps Tab', () => {
    expect(source).toContain("'Escape'");
    expect(source).toContain("'Tab'");
  });

  it('restores focus to whatever opened it', () => {
    expect(source).toContain('previouslyFocused');
  });

  it('gives the close button an accessible name', () => {
    // It was a bare × , which a screen reader announces as "multiplication
    // sign".
    expect(source).toMatch(/aria-label=\{`Close/);
  });
});

describe('StudentRow is memoised', () => {
  const source = read('src/features/dashboard/components/StudentRow.jsx');

  it('exports a memo-wrapped component with a custom comparator', () => {
    // The Firestore listener hands back a fresh object every snapshot, so
    // default shallow comparison would never hit.
    expect(source).toContain('memo(StudentRow, areEqual)');
  });

  it('compares the fields it renders', () => {
    for (const field of ['studentName', 'blocked', 'receiptStatus', 'approvalStatus']) {
      expect(source).toContain(`'${field}'`);
    }
  });
});
