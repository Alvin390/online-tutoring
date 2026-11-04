import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildIndex, searchStudents, DEFAULT_SEARCH_STATE } from '@features/dashboard/search/studentSearch';

/**
 * Student search speed — 001Fixes / 03.
 *
 * Production has 99 students (2026-10-26). These pin the headroom at 4×
 * (400) and at 5,000, with budgets generous enough for a loaded CI machine:
 *   400:   build < 10 ms, worst-case search < 4 ms
 *   5,000: build < 100 ms, worst-case search < 16 ms (one frame)
 * Results (median of 7) go to issues/001Fixes/plan/evidence/searchPerf.json
 * when that folder exists.
 *
 *   npx vitest run --config vitest.perf.config.js tests/perf/studentSearch.perf.test.jsx
 */

const FIRST = ['Amina', 'Brian', 'Wanjiru', 'Kevin', 'Faith', 'Otieno', 'Achieng', 'Mwangi', 'Zoë', 'Sean', 'Njeri', 'Kipchoge', 'Wambui', 'Ochieng', 'Mercy', 'Dennis', 'Akinyi', 'Kamau', 'Chebet', 'Mutua'];
const LAST = ['Wanjiku', 'Odhiambo', 'Kariuki', "O'Brien", 'Mwangi', 'Njoroge', 'Kiprono', 'Atieno', 'Muthoni', 'Omondi', 'Kimani', 'Wekesa'];
const CLASSES = ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3'];
const SUBJECTS = ['English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'CRE', 'Business', 'Agriculture', 'Computer', 'Community Service Learning (CSL)'];

// 006Fixes / 00: `seed % k` read the LCG's weak low bits, so 5,000 students
// got only 50 distinct name + class pairs (up to 361 students sharing one) —
// harmless for search, but since 003Fixes the build also finds possible
// duplicates, and that roster is nothing like a school. `crowded` keeps the
// old generator as the explicit worst case.
function makeStudents(n, { crowded = false } = {}) {
  let seed = 7;
  const rnd = (k) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return crowded ? seed % k : Math.floor(seed / 65536) % k;
  };
  return Array.from({ length: n }, (_, i) => ({
    id: `+2547${String(10000000 + i).padStart(8, '0')}`,
    studentName: `${FIRST[rnd(FIRST.length)]} ${LAST[rnd(LAST.length)]}`,
    class: CLASSES[rnd(4)],
    subjects: Array.from({ length: 3 + rnd(6) }, () => SUBJECTS[rnd(SUBJECTS.length)]).join(', '),
    receiptMessage: `QAB${i}XYZ9 Confirmed. Ksh1,500.00 sent to TUTOR on 1/10/26 at 8:15 AM New M-PESA balance is Ksh2,340.00.`,
    receiptStatus: rnd(10) ? 'pending' : 'approved',
    pendingReceipt: rnd(20) === 0 ? 'x' : null,
    blocked: rnd(30) === 0,
    feeBalance: rnd(15) === 0 ? 1500 : 0,
    approvalStatus: 'approved',
    registeredAt: { toMillis: () => 1790000000000 + i * 60000 },
  }));
}

const WORST = { ...DEFAULT_SEARCH_STATE, q: 'wanjikuu otieno', classes: ['Grade 10', 'Form 3'], subjects: ['Biology'], statuses: ['owes', 'review'] };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = {};

function measure(n, opts) {
  const builds = [];
  const searches = [];
  for (let run = 0; run < 7; run += 1) {
    const students = makeStudents(n, opts); // a fresh array: a cache miss, as after a snapshot
    let t = performance.now();
    const index = buildIndex(students);
    builds.push(performance.now() - t);
    searchStudents(index, WORST); // warm
    t = performance.now();
    searchStudents(index, WORST);
    searches.push(performance.now() - t);
  }
  results[opts?.crowded ? `${n}-crowded` : n] = { buildMs: +median(builds).toFixed(2), worstSearchMs: +median(searches).toFixed(2) };
  return results[opts?.crowded ? `${n}-crowded` : n];
}

describe('student search stays fast as the roster grows', () => {
  // 006Fixes / 00: the BUILD budgets were set in 001Fixes, when the build was
  // search records only. Since 003Fixes / 13 the same build also finds possible
  // duplicates (once per snapshot, never per keystroke), so they are revised:
  // 400 10 -> 15 ms (a smoke check: at this size the old and new duplicate
  // code are equal, ~1.4 ms) and 5,000 100 -> 180 ms (master 272 ms fails it).
  // The per-keystroke SEARCH budgets are unchanged.
  it('400 students (4× production)', () => {
    const r = measure(400);
    expect(r.buildMs).toBeLessThan(15);
    expect(r.worstSearchMs).toBeLessThan(4);
  });

  it('5,000 students', () => {
    const r = measure(5000);
    expect(r.buildMs).toBeLessThan(180);
    expect(r.worstSearchMs).toBeLessThan(16);
  });

  // 006Fixes / 00: the worst case for the duplicate check — 5,000 students in
  // 50 name + class groups of ~100 with near-identical numbers (61,886 pairs).
  // It took 10.7 s before the fix (and froze the tab); it must stay well
  // under a second.
  it('5,000 students crowded into 50 same-name groups (duplicate check worst case)', () => {
    const r = measure(5000, { crowded: true });
    expect(r.buildMs).toBeLessThan(600);
    expect(r.worstSearchMs).toBeLessThan(16);
  });
});

afterAll(() => {
  const dir = path.resolve('issues/001Fixes/plan/evidence');
  if (existsSync(path.resolve('issues'))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'searchPerf.json'), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
  }
});
