import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

/**
 * 009Fixes / 04 — "Numbers changed by students": from the rosters already
 * held (no reads), newest first, …old → …new and when; Open opens the student.
 */

afterEach(() => cleanup());
const ts = (iso) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const rosters = {
  morning: [
    { id: '+254711000123', studentName: 'Wanjiru Akinyi', numberFixedAt: ts('2026-11-16T07:00:00Z'), numberFixedFrom: '+254711000850' },
    { id: '+254711000124', studentName: 'Not Fixed' },
  ],
  evening: [
    { id: '+254711000200', studentName: 'Brian Otieno', numberFixedAt: ts('2026-11-16T09:00:00Z'), numberFixedFrom: '+254700000777' },
  ],
};

describe('NumberFixesPanel', () => {
  it('counts, lists newest first with old → new endings, opens the student', async () => {
    const onOpen = vi.fn();
    const { default: Panel } = await import('@features/dashboard/components/admission/NumberFixesPanel');
    render(<Panel rosters={rosters} sessionNames={{ morning: 'Morning', evening: 'Evening' }} onOpen={onOpen} />);
    expect(screen.getByText(/Numbers changed by students \(2\)/)).toBeTruthy();
    expect(screen.queryAllByTestId('number-fix')).toHaveLength(0); // collapsed
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    const rows = screen.getAllByTestId('number-fix');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Brian Otieno.*Evening.*…777.*…200/),
      expect.stringMatching(/Wanjiru Akinyi.*Morning.*…850.*…123/),
    ]);
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '+254711000123', __session: 'morning' }));
  });

  it('none yet: a count of 0 and nothing to show; no Open without the drawer', async () => {
    const { default: Panel } = await import('@features/dashboard/components/admission/NumberFixesPanel');
    render(<Panel rosters={{ morning: [{ id: 'x', studentName: 'A' }] }} />);
    expect(screen.getByText(/\(0\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show' }).disabled).toBe(true);
    cleanup();
    render(<Panel rosters={rosters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  // 014Fixes / 08: one switch — the panel follows checkin.admissionNumbers alone.
  it('the Approvals tab shows it only with admission numbers on', async () => {
    const flags = { 'checkin.admissionNumbers': true, 'registration.requireApproval': true };
    vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (k) => flags[k] === true }));
    vi.doMock('@features/dashboard/components/PendingApprovalsPanel', () => ({ default: () => <div /> }));
    vi.doMock('@features/dashboard/components/admission/WaitingCodesPanel', () => ({ default: () => <div /> }));
    const { default: ApprovalsTab } = await import('@features/dashboard/tabs/ApprovalsTab');
    render(<ApprovalsTab pending={[]} rosters={rosters} sessions={[]} />);
    expect(await screen.findByTestId('number-fixes')).toBeTruthy();
    cleanup();
    flags['checkin.admissionNumbers'] = false;
    render(<ApprovalsTab pending={[]} rosters={rosters} sessions={[]} />);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(screen.queryByTestId('number-fixes')).toBeNull();
    vi.doUnmock('@shared/config/FlagsContext');
    vi.doUnmock('@features/dashboard/components/PendingApprovalsPanel');
    vi.doUnmock('@features/dashboard/components/admission/WaitingCodesPanel');
  });
});
