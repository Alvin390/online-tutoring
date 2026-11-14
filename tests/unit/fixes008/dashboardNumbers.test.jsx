import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { buildIndex, searchStudents, DEFAULT_SEARCH_STATE } from '@features/dashboard/search/studentSearch';

/**
 * 008Fixes / 05 — the dashboard: numbers on rows and on the Staff tab, search
 * by number, the teacher changes a number, "Allow again", and the codes the
 * students are waiting for.
 */

const admission = vi.hoisted(() => ({ setAdmissionNumber: vi.fn(), allowCheckinAgain: vi.fn(), listWaitingCodes: vi.fn() }));
vi.mock('@services/api/admission', () => admission);
const live = vi.hoisted(() => ({ checkNumber: vi.fn() }));
vi.mock('@services/api/studentAdmission', () => live);
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => toast, useOptionalToast: () => toast }));

beforeEach(() => {
  for (const fn of [...Object.values(admission), ...Object.values(live), ...Object.values(toast)]) fn.mockReset();
  live.checkNumber.mockResolvedValue({ status: 'free', message: 'Available' });
});
afterEach(() => cleanup());

const click = async (name) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };

describe('search by number', () => {
  const roster = [
    { id: '+254711000001', parentPhone: '+254711000001', studentName: 'Amina Wanjiku', class: 'Form 3', admissionNumber: '0042' },
    { id: '+254711000002', parentPhone: '+254711000002', studentName: 'Brian Otieno', class: 'Form 3', admissionNumber: '4071' },
    { id: '+254711000003', parentPhone: '+254711000003', studentName: 'Cecilia Teacher', class: 'Form 3', staff: true, staffNumber: '0042' },
  ];
  const find = (q) => searchStudents(buildIndex(roster, 'evening'), { ...DEFAULT_SEARCH_STATE, q }).results.map((r) => r.studentName ?? r.student?.studentName);

  it('"0042" finds the admission number; "S-0042" the staff number', () => {
    expect(find('4071')).toEqual(['Brian Otieno']);
    expect(find('0042')).toContain('Amina Wanjiku');
    expect(find('S-0042')).toContain('Cecilia Teacher');
  });
});

describe('the row', () => {
  const base = {
    id: '+254711000001', studentName: 'Claire Job', parentPhone: '+254711000001', class: 'Form 3', subjects: 'English',
    receiptMessage: 'old', receiptStatus: 'approved', blocked: false, feeBalance: 0, approvalStatus: 'approved',
  };
  const renderRow = async (student) => {
    const { default: StudentRow } = await import('@features/dashboard/components/StudentRow');
    const { LazyMotion, domAnimation } = await import('framer-motion');
    return render(<LazyMotion features={domAnimation}><table><tbody>
      <StudentRow student={student} index={0} session="evening" onApprove={vi.fn()} onDecline={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onBlock={vi.fn()} onUnblock={vi.fn()} />
    </tbody></table></LazyMotion>);
  };

  it('shows the admission number; nothing when there is none', async () => {
    await renderRow({ ...base, admissionNumber: '0042' });
    expect(screen.getByTestId('row-number').textContent).toBe('#0042');
    cleanup();
    await renderRow(base);
    expect(screen.queryByTestId('row-number')).toBeNull();
  });

  it('a number change re-renders the memoised row', async () => {
    const { default: StudentRow } = await import('@features/dashboard/components/StudentRow');
    const { LazyMotion, domAnimation } = await import('framer-motion');
    const props = { index: 0, session: 'evening', onApprove: vi.fn(), onDecline: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onBlock: vi.fn(), onUnblock: vi.fn() };
    const view = (student) => <LazyMotion features={domAnimation}><table><tbody><StudentRow student={student} {...props} /></tbody></table></LazyMotion>;
    const { rerender } = render(view({ ...base, admissionNumber: '0042' }));
    rerender(view({ ...base, admissionNumber: '7319' }));
    expect(screen.getByTestId('row-number').textContent).toBe('#7319');
  });
});

describe('AdmissionActions (drawer and Staff tab)', () => {
  const renderActions = async (record) => {
    const { default: AdmissionActions } = await import('@features/dashboard/components/admission/AdmissionActions');
    render(<AdmissionActions session="evening" phone="+254711000001" record={record} />);
  };

  it('shows the number, or "No number yet"; staff as S-', async () => {
    await renderActions({ admissionNumber: '0042' });
    expect(screen.getByTestId('admission-number').textContent).toBe('0042');
    cleanup();
    await renderActions({});
    expect(screen.getByTestId('admission-number').textContent).toBe('No number yet');
    expect(screen.getByRole('button', { name: 'Set number' })).toBeTruthy();
    cleanup();
    await renderActions({ staff: true, staffNumber: '0042' });
    expect(screen.getByTestId('admission-number').textContent).toBe('S-0042');
  });

  it('Change: live check, save, the new number shown; a taken number says so', async () => {
    admission.setAdmissionNumber.mockResolvedValueOnce({ ok: true, kind: 'student', number: '7319', display: '7319' });
    await renderActions({ admissionNumber: '0042' });
    await click('Change');
    await act(async () => { fireEvent.change(screen.getByLabelText(/New admission number/), { target: { value: '7319' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save number' }).disabled).toBe(false));
    await click('Save number');
    expect(admission.setAdmissionNumber).toHaveBeenCalledWith('evening', '+254711000001', '7319');
    expect(screen.getByTestId('admission-number').textContent).toBe('7319');
    expect(toast.showSuccess).toHaveBeenCalledWith('Number set to 7319.');

    admission.setAdmissionNumber.mockRejectedValueOnce(Object.assign(new Error('That number is taken. Choose another.'), { code: 'number_taken' }));
    await click('Change');
    await act(async () => { fireEvent.change(screen.getByLabelText(/New admission number/), { target: { value: '5820' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save number' }).disabled).toBe(false));
    await click('Save number');
    expect((await screen.findByRole('alert')).textContent).toBe('That number is taken. Choose another.');
  });

  it('an easy number is refused before any request', async () => {
    await renderActions({ admissionNumber: '0042' });
    await click('Change');
    await act(async () => { fireEvent.change(screen.getByLabelText(/New admission number/), { target: { value: '1234' } }); });
    expect(screen.getByText(/too easy to guess/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save number' }).disabled).toBe(true);
    expect(live.checkNumber).not.toHaveBeenCalled();
  });

  it('"Allow again": asks first, then calls and says done', async () => {
    admission.allowCheckinAgain.mockResolvedValueOnce({ ok: true });
    await renderActions({ admissionNumber: '0042' });
    await click('Allow again');
    expect(screen.getByText('Let them check in on another device for this class?')).toBeTruthy();
    expect(admission.allowCheckinAgain).not.toHaveBeenCalled();
    await click('Yes, allow');
    expect(admission.allowCheckinAgain).toHaveBeenCalledWith('evening', '+254711000001');
    expect(toast.showSuccess).toHaveBeenCalledWith('Done. They can check in now.');
  });
});

describe('Codes waiting', () => {
  const renderPanel = async () => {
    const { default: WaitingCodesPanel } = await import('@features/dashboard/components/admission/WaitingCodesPanel');
    render(<WaitingCodesPanel sessionNames={{ evening: 'Evening' }} />);
  };

  it('reads only when opened; shows name, session, phone ending, the code, minutes left; Refresh reads again', async () => {
    admission.listWaitingCodes.mockResolvedValue({
      codes: [{ session: 'evening', phone: '+254711000678', phoneEnding: '678', name: 'Amina', code: '482913', expiresAtMs: Date.now() + 6 * 60_000 - 1000 }],
    });
    await renderPanel();
    expect(admission.listWaitingCodes).not.toHaveBeenCalled();
    expect(screen.getByText("If a student's SMS doesn't arrive, read them their code.")).toBeTruthy();
    await click('Show codes');
    expect((await screen.findByTestId('waiting-code')).textContent).toBe('482913');
    expect(screen.getByText('Evening · phone ending 678')).toBeTruthy();
    expect(screen.getByText('expires in 6 min')).toBeTruthy();
    expect(screen.getByText('Codes waiting (1)')).toBeTruthy();
    await click('Refresh');
    expect(admission.listWaitingCodes).toHaveBeenCalledTimes(2);
  });

  it('empty: "No codes waiting."', async () => {
    admission.listWaitingCodes.mockResolvedValue({ codes: [] });
    await renderPanel();
    await click('Show codes');
    expect(await screen.findByText('No codes waiting.')).toBeTruthy();
  });
});

describe('the Staff tab', () => {
  it('shows S- numbers, "No staff number yet", and finds by S-number', async () => {
    vi.resetModules();
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
    vi.doMock('@services/api/students', () => ({ unmarkStaff: vi.fn() }));
    const { default: StaffTab } = await import('@features/dashboard/tabs/StaffTab');
    const since = { toDate: () => new Date('2026-11-12T08:00:00Z') };
    render(<StaffTab
      sessions={[{ id: 'evening', name: 'Evening', classes: ['Form 3'] }]}
      staffBySession={{ evening: [
        { id: '+254700000544', studentName: 'Brian Kiplimo', class: 'Form 3', staff: true, staffAt: since, staffNumber: '0042' },
        { id: '+254700000618', studentName: 'Cecilia', class: 'Form 3', staff: true, staffAt: since },
      ] }}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />);
    const numbers = screen.getAllByTestId('staff-number').map((n) => n.textContent);
    expect(numbers).toEqual(['S-0042', 'No staff number yet']);
    await act(async () => { fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'S-0042' } }); });
    expect(screen.getAllByTestId('staff-row')).toHaveLength(1);
    vi.doUnmock('@shared/config/FlagsContext');
    vi.doUnmock('@services/api/students');
  });
});
