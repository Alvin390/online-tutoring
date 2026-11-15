import { describe, it, expect } from 'vitest';
import * as client from '@shared/utils/admissionNumber';
import * as server from '../../../api/_lib/admissionNumber.js';

/**
 * 008Fixes / 02 — the admission-number rule (owner answer 6): 4 digits,
 * leading zeros kept, easy numbers refused. The browser and the server must
 * give the same answer for every number.
 */

const all = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, '0'));

describe('the rule', () => {
  it('refuses all-the-same, straight runs and two-digit repeats; nothing else', () => {
    const easy = all.filter((n) => client.numberProblem(n) === 'easy');
    // 10 all-same + 7 up + 7 down + 90 more two-digit repeats (abab, a ≠ b).
    expect(easy).toHaveLength(114);
    for (const n of ['0000', '7777', '0123', '1234', '6789', '9876', '3210', '1212', '0101', '9090']) {
      expect(client.numberProblem(n), n).toBe('easy');
    }
    for (const n of ['0042', '4071', '1235', '7890', '0987', '1221', '1122', '2468']) {
      expect(client.numberProblem(n), n).toBeNull();
    }
  });

  it('format: exactly 4 digits', () => {
    for (const n of ['', '12', '12345', '12a4', ' 4071', null, undefined]) {
      expect(client.numberProblem(n), String(n)).toBe('format');
    }
    expect(client.numberProblemMessage('easy')).toMatch(/too easy to guess/);
    expect(client.numberProblemMessage('format')).toMatch(/exactly 4 digits/);
  });

  it('the browser and server copies agree on all 10,000 numbers and on parsing', () => {
    for (const n of all) expect(server.numberProblem(n)).toBe(client.numberProblem(n));
    for (const typed of ['0042', 'S-0042', 's0042', 'S 0042', ' 4071 ', 'S--0042', '42', 'X-0042', '']) {
      expect(server.parseNumberInput(typed)).toEqual(client.parseNumberInput(typed));
    }
    expect(server.EASY_NUMBER_MESSAGE).toBe(client.EASY_NUMBER_MESSAGE);
  });
});

describe('typing, showing and storing', () => {
  it('parses admission and staff numbers', () => {
    expect(client.parseNumberInput('0042')).toEqual({ kind: 'student', digits: '0042' });
    expect(client.parseNumberInput('S-0042')).toEqual({ kind: 'staff', digits: '0042' });
    expect(client.parseNumberInput('s 0042')).toEqual({ kind: 'staff', digits: '0042' });
    expect(client.parseNumberInput('S--0042')).toBeNull();
    expect(client.parseNumberInput('42')).toBeNull();
  });

  it('shows S- for staff, keeps leading zeros, and reserves A/S ids', () => {
    expect(client.formatNumber('student', '0042')).toBe('0042');
    expect(client.formatNumber('staff', '0042')).toBe('S-0042');
    expect(client.reservationId('student', '0042')).toBe('A0042');
    expect(client.reservationId('staff', '0042')).toBe('S0042');
  });

  it('reads the number a record holds (staff hold staffNumber)', () => {
    expect(client.recordNumber({ admissionNumber: '0042' })).toEqual({ kind: 'student', digits: '0042' });
    expect(client.recordNumber({ staff: true, staffNumber: '0042' })).toEqual({ kind: 'staff', digits: '0042' });
    expect(client.recordNumber({ staff: true, admissionNumber: '0042' })).toBeNull();
    expect(client.recordNumber({})).toBeNull();
    expect(client.recordNumber(null)).toBeNull();
  });
});
