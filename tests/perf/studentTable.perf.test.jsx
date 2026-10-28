import { describe, it, expect, afterAll, vi } from 'vitest';
import { Profiler } from 'react';
import { render, act } from '@testing-library/react';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import StudentTable from '@features/dashboard/components/StudentTable';

// Phase 13 / 04 made StudentTable read the fees flag and the tier (block-kind
// default); this benchmark mounts it outside the providers.
vi.mock('@features/auth/context/AuthContext', () => ({
  useAuthState: () => ({ tierRank: 3, isSuperadmin: false }),
}));
vi.mock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));

/**
 * Render-cost benchmark — Phase 13 / 01 D3 ("React render cost").
 *
 * Not a pass/fail test of speed (jsdom timing is noisy and machine-dependent);
 * it RECORDS React Profiler `actualDuration` for:
 *   - mounting the student table with 500 rows
 *   - one student's data changing (the check-in case Phase 10 memoised)
 * as the median of 5 runs, so phase 08 can compare against the same harness.
 *
 *   npm run perf:render   →  issues/plan/baseline/render.json (if issues/ exists)
 */

const noop = () => {};
const makeStudents = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `+2547${String(10000000 + i).padStart(8, '0')}`,
    studentName: `Student ${i}`,
    parentPhone: `+2547${String(10000000 + i).padStart(8, '0')}`,
    class: `Grade ${4 + (i % 9)}`,
    subjects: 'Mathematics, Physics',
    receiptMessage: `QX${i} Confirmed. Ksh3,000 sent.`,
    registeredAt: { toDate: () => new Date(2026, 0, 1), toMillis: () => 1767225600000 },
    blocked: false,
    approvalStatus: 'approved',
    receiptStatus: 'approved',
  }));

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = {};

function Harness({ students, onRender }) {
  return (
    <Profiler id="table" onRender={(_id, phase, actual) => onRender(phase, actual)}>
      <StudentTable session="morning" students={students} loading={false}
        onDelete={noop} onEdit={noop} onView={noop} onExport={noop}
        onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} />
    </Profiler>
  );
}

// jsdom does no layout: every element measures 0 px. Rows are given the
// height they have in a browser (64 px). Phase 13 / 08 B2 needed this for the
// virtualiser; since 003Fixes / 02 the table renders one page of 20 rows, so
// "mount at 500" now measures the paged table over a 500-student roster.
const realRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function rect() {
  if (this.tagName === 'TR') return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 64, width: 1200, height: 64, toJSON() {} };
  return realRect.call(this);
};
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

describe('StudentTable render cost (recorded, not asserted)', () => {
  it('mount and single-row update at 500 rows', () => {
    const mounts = [];
    const updates = [];
    let rowCount = 0;

    for (let run = 0; run < 5; run += 1) {
      const students = makeStudents(500);
      let phaseLog = [];
      let view;
      // Every commit until the table settles counts as "mount".
      act(() => {
        view = render(<Harness students={students} onRender={(p, d) => phaseLog.push([p, d])} />);
      });
      const { rerender, unmount, container } = view;
      mounts.push(phaseLog.reduce((s, [, d]) => s + d, 0));
      rowCount = container.querySelectorAll('tbody tr').length;

      phaseLog = [];
      const next = students.map((s, i) => (i === 7 ? { ...s, studentName: 'Changed Name' } : { ...s }));
      act(() => {
        rerender(<Harness students={next} onRender={(p, d) => phaseLog.push([p, d])} />);
      });
      updates.push(phaseLog.reduce((s, [, d]) => s + d, 0));
      unmount();
    }

    results.studentTable500 = {
      rowsInDom: rowCount,
      mountMsMedian: Number(median(mounts).toFixed(1)),
      singleRowUpdateMsMedian: Number(median(updates).toFixed(1)),
      runs: 5,
      environment: 'jsdom (relative comparison only)',
    };
    expect(rowCount).toBeGreaterThan(0);
  });
});

afterAll(() => {
  const out = process.env.PERF_OUT ?? path.join(process.cwd(), 'issues/plan/baseline/render.json');
  try {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 2));
  } catch { /* issues/ is optional; results are also printed */ }
  console.log('RENDER_RESULTS', JSON.stringify(results));
});
