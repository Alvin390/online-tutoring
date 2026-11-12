import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 007Fixes / 09 — staff are "on the side" (owner: the number of students must
 * be the real number). The dashboard keeps its one roster listener per
 * session and splits each snapshot in memory: students go where they always
 * went, staff to their own list. Everything that reads the students (counts,
 * cards, search, filters, partial line, duplicates, export, selection) then
 * never sees staff; pending approvals drop them too. No new listener.
 */

let rosterCallbacks;
let pendingCallback;
let subscriptions;

beforeEach(() => {
  vi.resetModules();
  rosterCallbacks = new Map();
  subscriptions = 0;
  vi.doMock('@services/firebase/firestore', () => ({
    subscribeToStudents: (id, cb) => { subscriptions += 1; rosterCallbacks.set(id, cb); return () => {}; },
    subscribeToPendingApprovals: (cb) => { pendingCallback = cb; return () => {}; },
    getZoomLinks: vi.fn().mockResolvedValue({}),
    subscribeToClassLink: () => () => {},
    blockStudent: vi.fn(), unblockStudent: vi.fn(), approveReceipt: vi.fn(), declineReceipt: vi.fn(),
  }));
  vi.doMock('@features/sessions/hooks/useSessions', () => ({
    useSessions: () => ({ sessions: [{ id: 'morning', name: 'Morning', active: true }, { id: 'evening', name: 'Evening', active: true }], loading: false }),
  }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
});

const person = (i, extra = {}) => ({ id: `+2547000${String(i).padStart(5, '0')}`, studentName: `Person ${i}`, class: 'Form 3', ...extra });

describe('the roster is split into students and staff', () => {
  it('3 staff + 10 students: the dashboard counts 10 students and 3 staff, from the same listener', async () => {
    const { useDashboard } = await import('@features/dashboard/hooks/useDashboard');
    const { result } = renderHook(() => useDashboard());
    const morning = [
      ...Array.from({ length: 7 }, (_, i) => person(i)),
      person(100, { staff: true }), person(101, { staff: true }),
    ];
    const evening = [...Array.from({ length: 3 }, (_, i) => person(20 + i)), person(102, { staff: true })];
    act(() => {
      rosterCallbacks.get('morning')(morning);
      rosterCallbacks.get('evening')(evening);
    });

    expect(result.current.studentsBySession.morning).toHaveLength(7);
    expect(result.current.studentsBySession.evening).toHaveLength(3);
    expect(Object.values(result.current.studentsBySession).flat().some((s) => s.staff === true)).toBe(false);
    expect(result.current.totalStudents).toBe(10);
    expect(result.current.staffBySession.morning.map((s) => s.id)).toEqual([person(100).id, person(101).id]);
    expect(result.current.staffBySession.evening).toHaveLength(1);
    expect(result.current.staffCount).toBe(3);
    // Still one listener per session: nothing new subscribed for staff.
    expect(subscriptions).toBe(2);
  });

  it('pending approvals leave a staff record out', async () => {
    const { useDashboard } = await import('@features/dashboard/hooks/useDashboard');
    const { result } = renderHook(() => useDashboard());
    act(() => pendingCallback([
      { ...person(1), session: 'morning', approvalStatus: 'pending' },
      { ...person(2, { staff: true }), session: 'morning', approvalStatus: 'pending' },
    ]));
    expect(result.current.pendingApprovals.map((s) => s.id)).toEqual([person(1).id]);
  });

  it('marking someone moves them across on the next snapshot (no reload)', async () => {
    const { useDashboard } = await import('@features/dashboard/hooks/useDashboard');
    const { result } = renderHook(() => useDashboard());
    act(() => rosterCallbacks.get('morning')([person(1), person(2)]));
    expect(result.current.totalStudents).toBe(2);
    act(() => rosterCallbacks.get('morning')([person(1), person(2, { staff: true })]));
    expect(result.current.totalStudents).toBe(1);
    expect(result.current.staffCount).toBe(1);
  });
});

describe('splitStaff', () => {
  it('one pass, order kept; a record without the field is a student', async () => {
    const { splitStaff } = await import('@features/dashboard/staff/splitStaff');
    const list = [person(1), person(2, { staff: true }), person(3, { staff: false }), person(4, { staff: null }), person(5, { staff: true })];
    const { students, staff } = splitStaff(list);
    expect(students.map((s) => s.id)).toEqual([person(1).id, person(3).id, person(4).id]);
    expect(staff.map((s) => s.id)).toEqual([person(2).id, person(5).id]);
  });
});
