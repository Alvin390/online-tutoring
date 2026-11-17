import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 011Fixes / 04 — the dashboard's exportToPDF hands the table's columns (from
 * Export) to the PDF builder; with none (an older caller) the PDF is as today.
 */

const built = vi.hoisted(() => ({ calls: [] }));

beforeEach(() => {
  vi.resetModules();
  built.calls = [];
  vi.doMock('@services/firebase/firestore', () => ({
    subscribeToStudents: () => () => {},
    subscribeToPendingApprovals: () => () => {},
    getZoomLinks: vi.fn().mockResolvedValue({}),
    subscribeToClassLink: () => () => {},
    blockStudent: vi.fn(), unblockStudent: vi.fn(), approveReceipt: vi.fn(), declineReceipt: vi.fn(),
  }));
  vi.doMock('@features/sessions/hooks/useSessions', () => ({
    useSessions: () => ({ sessions: [{ id: 'morning', name: 'Morning', active: true }], loading: false }),
  }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: () => true }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
  vi.doMock('@features/dashboard/hooks/studentsPdf', () => ({
    buildStudentsPdf: async (args) => { built.calls.push(args); return { save: vi.fn() }; },
  }));
});

const students = [{ id: '+254711000001', studentName: 'Student 1', class: 'Form 3' }];

describe('exportToPDF', () => {
  it('passes the view\'s columns on', async () => {
    const { useDashboard } = await import('@features/dashboard/hooks/useDashboard');
    const { result } = renderHook(() => useDashboard());
    const columns = [{ id: 'select', currentWidth: 140 }, { id: 'name', currentWidth: 190 }];
    await act(() => result.current.exportToPDF('morning', { students, columns }));
    expect(built.calls[0].columns).toBe(columns);
  });

  it('no columns given: none passed (today\'s PDF)', async () => {
    const { useDashboard } = await import('@features/dashboard/hooks/useDashboard');
    const { result } = renderHook(() => useDashboard());
    await act(() => result.current.exportToPDF('morning', { students }));
    expect(built.calls[0].columns).toBeUndefined();
  });
});
