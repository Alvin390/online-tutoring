import { describe, it, expect } from 'vitest';
import { assertDemoProject, demoStudents, demoPhone } from '../../../scripts/seedDemo.mjs';

/**
 * 013Fixes / 35 — the demo copy's seed: never production, only a project
 * whose id says "demo" (or the emulator); sample names and numbers only.
 */

describe('seedDemo', () => {
  it('refuses production and any project without "demo" in its id', () => {
    expect(() => assertDemoProject('online-tutoring-6d71a')).toThrow(/refuses/);
    expect(() => assertDemoProject('some-school')).toThrow(/refuses/);
    expect(() => assertDemoProject(undefined)).toThrow(/refuses/);
    expect(() => assertDemoProject('online-tutoring-demo')).not.toThrow();
    expect(() => assertDemoProject('anything', { emulator: true })).not.toThrow();
  });

  it('sample data only: every name ends in "Demo", every number in the +254 700 00x block', () => {
    const students = demoStudents();
    expect(students.length).toBeGreaterThan(10);
    for (const s of students) {
      expect(s.data.studentName).toMatch(/^[A-Z][a-z]+ Demo$/);
      expect(s.phone).toMatch(/^\+2547000\d{5}$/);
      expect(s.data.parentPhone).toBe(s.phone);
    }
    expect(new Set(students.map((s) => s.phone)).size).toBe(students.length);
    expect(demoPhone(0)).toBe('+254700010000');
  });
});
