import { describe, it, expect, afterAll } from 'vitest';
import { Profiler } from 'react';
import { render, act } from '@testing-library/react';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import StudentTable from '@features/dashboard/components/StudentTable';

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

describe('StudentTable render cost (recorded, not asserted)', () => {
  it('mount and single-row update at 500 rows', () => {
    const mounts = [];
    const updates = [];
    let rowCount = 0;

    for (let run = 0; run < 5; run += 1) {
      const students = makeStudents(500);
      let phaseLog = [];
      const { rerender, unmount, container } = render(
        <Harness students={students} onRender={(p, d) => phaseLog.push([p, d])} />
      );
      mounts.push(phaseLog.filter(([p]) => p === 'mount').reduce((s, [, d]) => s + d, 0));
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
