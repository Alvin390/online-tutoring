import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Phase 13 / 03 — client side of student record integrity.
 * Ports S-phone, S-schema, B10, B7 (client) and adds the source guards.
 */

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
describe('D4 phone numbers (S-phone)', () => {
  it('typing 0712345678 for Kenya gives +254712345678', async () => {
    const { usePhoneValidation } = await import('@/features/registration/hooks/usePhoneValidation.js');
    const { countries } = await import('@/shared/constants/countries.js');
    const { result } = renderHook(() => usePhoneValidation());
    act(() => result.current.handleCountryChange(countries.find((c) => c.code === 'KE')));
    act(() => result.current.handlePhoneChange('0712 345 678'));
    expect(result.current.getFullPhoneNumber()).toBe('+254712345678');
    expect(result.current.isValid).toBe(true);
  });

  it.each([
    ['KE', '0712345678', '712345678'],
    ['UG', '0772123456', '772123456'],
    ['TZ', '0712345678', '712345678'],
    ['RW', '0788123456', '788123456'],
    ['NG', '08031234567', '8031234567'],
    ['GH', '0241234567', '241234567'],
    ['ZA', '0821234567', '821234567'],
    ['GB', '07700900123', '7700900123'],
    ['AU', '0412345678', '412345678'],
    ['IN', '09876543210', '9876543210'],
    ['DE', '015112345678', '15112345678'],
    ['FR', '0612345678', '612345678'],
    ['NL', '0612345678', '612345678'],
    ['US', '2025550123', '2025550123'],
    ['KE', '712345678', '712345678'],
  ])('%s: %s → %s', async (code, input, expected) => {
    const { countries, normaliseNationalNumber } = await import('@/shared/constants/countries.js');
    expect(normaliseNationalNumber(countries.find((c) => c.code === code), input)).toBe(expected);
  });

  it('leaves countries without a trunk 0 untouched (Italy keeps its 0)', async () => {
    const { countries, normaliseNationalNumber } = await import('@/shared/constants/countries.js');
    expect(normaliseNationalNumber(countries.find((c) => c.code === 'IT'), '0612345678')).toBe('0612345678');
  });

  it('client and server trunk-0 lists agree', async () => {
    const { TRUNK_ZERO_DIALS } = await import('@/shared/constants/countries.js');
    const { TRUNK_ZERO_CODES } = await import('../../../api/_lib/validate.js');
    expect([...TRUNK_ZERO_DIALS].map((d) => d.slice(1)).sort()).toEqual([...TRUNK_ZERO_CODES].sort());
    const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    const ruleList = /\^\\\\\+\(([0-9|]+)\)0/.exec(rules)[1].split('|').sort();
    expect(ruleList).toEqual([...TRUNK_ZERO_CODES].sort());
  });
});

// ---------------------------------------------------------------------------
describe('D5 names (S-schema)', () => {
  it.each([["Sean O'Brien"], ['Mary-Jane Wanjiru'], ['Zoë Achieng'], ['N’Golo Kanté'], ['J. R. Otieno']])(
    'accepts %s',
    async (name) => {
      const { registrationSchema } = await import('@/features/registration/schemas/registrationSchema.js');
      expect(registrationSchema.shape.studentName.safeParse(name).success).toBe(true);
    }
  );

  it.each([['<script>'], ['1234'], ['A'], ['-Dash first']])('rejects %s', async (name) => {
    const { registrationSchema } = await import('@/features/registration/schemas/registrationSchema.js');
    expect(registrationSchema.shape.studentName.safeParse(name).success).toBe(false);
  });

  it('trims and collapses spaces', async () => {
    const { registrationSchema } = await import('@/features/registration/schemas/registrationSchema.js');
    expect(registrationSchema.shape.studentName.parse('  Mary   Jane ')).toBe('Mary Jane');
  });

  it('client and server name rules agree', async () => {
    const { STUDENT_NAME_PATTERN: client } = await import('@/features/registration/schemas/registrationSchema.js');
    const { STUDENT_NAME_PATTERN: server } = await import('../../../api/_lib/validate.js');
    expect(client.source).toBe(server.source);
    expect(client.flags).toBe(server.flags);
  });
});

// ---------------------------------------------------------------------------
describe('D6 no double escaping (B10)', () => {
  it("renders O'Brien and Maths & Science literally", async () => {
    const { default: StudentRow } = await import('@/features/dashboard/components/StudentRow.jsx');
    const student = { id: '+254712345678', studentName: "O'Brien", parentPhone: '+254712345678', class: 'G8', subjects: 'Maths & Science', receiptMessage: 'QAB' };
    const noop = () => {};
    render(<table><tbody><StudentRow student={student} index={0} session="s" onDelete={noop} onEdit={noop}
      onBlock={noop} onUnblock={noop} onApprove={noop} onDecline={noop} /></tbody></table>);
    expect(screen.getByText("O'Brien")).toBeTruthy();
    expect(screen.getByText('Maths & Science')).toBeTruthy();
    expect(screen.queryByText(/&#039;|&amp;/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('D3 approval parity (B7 client)', () => {
  it('client and server effectiveApprovalStatus agree on every input', async () => {
    const client = await import('@/shared/utils/studentState.js');
    const server = await import('../../../api/_lib/studentState.js');
    for (const input of [undefined, null, {}, { approvalStatus: undefined }, { approvalStatus: '' },
      { approvalStatus: 'pending' }, { approvalStatus: 'approved' }, { approvalStatus: 'rejected' }]) {
      expect(client.effectiveApprovalStatus(input)).toBe(server.effectiveApprovalStatus(input));
    }
    expect(client.effectiveApprovalStatus({})).toBe('approved');
  });

  it('the client gate now treats the checkin projection of a legacy student as approved', async () => {
    const { resolveStudentGate } = await import('@/shared/utils/studentGate.js');
    expect(resolveStudentGate({ blocked: false }, { requireApproval: true }).screen).toBe('welcome');
  });
});

// ---------------------------------------------------------------------------
describe('source guards', () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : /\.(jsx?|tsx?)$/.test(n) ? [full] : [];
  });
  const files = walk(path.join(ROOT, 'src'));

  it('no client code deletes a student document directly (notes would be orphaned)', () => {
    const offenders = files.filter((f) => /deleteDoc\s*\(/.test(readFileSync(f, 'utf8')))
      .filter((f) => /students/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the dashboard edits through the API, never through the registration create', () => {
    const src = readFileSync(path.join(ROOT, 'src/features/dashboard/hooks/useDashboard.js'), 'utf8');
    expect(src).not.toMatch(/registerStudent/);
    expect(src).toMatch(/updateStudentRecord/);
    expect(src).toMatch(/removeStudent/);
  });

  it('no escapeHtml in JSX components', () => {
    const offenders = files.filter((f) => f.endsWith('.jsx') && /escapeHtml\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('useDashboard.updateStudent calls the API', () => {
  it('sends only the four fields and the new phone, and resumes a partial move', async () => {
    vi.resetModules();
    const updateStudentRecord = vi.fn()
      .mockResolvedValueOnce({ ok: true, partial: true })
      .mockResolvedValueOnce({ ok: true, phone: '+254711000002' });
    vi.doMock('@services/api/sessions', () => ({ updateStudentRecord, removeStudent: vi.fn(), manageSession: vi.fn() }));
    vi.doMock('@features/sessions/hooks/useSessions', () => ({ useSessions: () => ({ sessions: [], loading: false }) }));
    vi.doMock('@services/firebase/firestore', () => ({
      subscribeToStudents: () => () => {}, subscribeToPendingApprovals: () => () => {},
      subscribeToClassLink: () => () => {}, getZoomLinks: async () => ({}),
      blockStudent: vi.fn(), unblockStudent: vi.fn(), approveReceipt: vi.fn(), declineReceipt: vi.fn(),
    }));
    vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useOptionalToast: () => null }));
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => false }));
    const { useDashboard } = await import('@/features/dashboard/hooks/useDashboard.js');
    const { result } = renderHook(() => useDashboard());

    let outcome;
    await act(async () => {
      outcome = await result.current.updateStudent('morning', '+254711000002',
        { studentName: ' Amina ', class: 'Grade 9', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x', parentPhone: '+254711000002', feeBalance: 0 },
        '+254711000001');
    });
    expect(outcome.success).toBe(true);
    expect(updateStudentRecord).toHaveBeenCalledTimes(2);
    expect(updateStudentRecord).toHaveBeenLastCalledWith('morning', '+254711000001',
      { studentName: 'Amina', class: 'Grade 9', subjects: 'Maths', receiptMessage: 'QAB123XYZ9 x' }, '+254711000002');
  });
});
