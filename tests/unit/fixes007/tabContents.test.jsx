import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * 007Fixes / 05: each tab looks like its own page. (The Students tab's stats
 * cards stay: owner review, 2026-11-12.) Fees gains shortcuts to the filtered
 * student list; Setup is two plain sections; empty tabs say so in plain words.
 */

const passThrough = (name) => () => ({ default: ({ children }) => <div data-testid={name}>{children}</div> });
const stub = (name) => () => ({ default: () => <div data-testid={name} /> });

const roster = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `S ${i}` }));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { cleanup(); vi.doUnmock('@features/dashboard/components/StudentSearchPanel'); });

describe('Students: the stats cards (owner review of Release A, 2026-11-12)', () => {
  // Phase 05 replaced them with a count line; the owner asked for the cards
  // back exactly as before: "those were really nice".
  it('shows the cards (two sessions, Total Students, Class Links) above the session tabs', async () => {
    vi.doMock('@features/dashboard/components/StudentSearchPanel', stub('search'));
    const { default: StudentsTab } = await import('@features/dashboard/tabs/StudentsTab');
    const sessionTabs = [
      { id: 'morning', name: 'Morning', icon: 'bi-sun' },
      { id: 'evening', name: 'Evening', icon: 'bi-moon' },
      { id: 'weekend', name: 'Weekend', icon: 'bi-book' },
    ];
    const { container } = render(
      <MemoryRouter>
        <StudentsTab
          studentsBySession={{ morning: roster(17, 'm'), evening: roster(17, 'e'), weekend: roster(16, 'w') }}
          sessions={sessionTabs}
          sessionTabs={sessionTabs}
          totalStudents={50}
          linksConfigured={2}
          linksTotal={3}
          activeSession="morning"
          setActiveSession={() => {}}
          currentStudents={[]}
          loading={false}
          actions={{}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.stat-card')).toHaveLength(4);
    const text = container.textContent;
    expect(text).toMatch(/Total Students/);
    expect(text).toMatch(/Class Links/);
    expect(text).toMatch(/2\/3/);
    expect(screen.queryByTestId('count-line')).toBeNull();
  });
});

describe('Fees: shortcuts to the student list', () => {
  async function renderFees(partial) {
    vi.doMock('@features/fees/components/FeeKpiCards', stub('kpis'));
    vi.doMock('@shared/components/TierGate', passThrough('gate'));
    const { default: FeesOverviewTab } = await import('@features/dashboard/tabs/FeesOverviewTab');
    render(<MemoryRouter><FeesOverviewTab sessions={[]} partial={partial} /></MemoryRouter>);
  }
  afterEach(() => { vi.doUnmock('@features/fees/components/FeeKpiCards'); vi.doUnmock('@shared/components/TierGate'); });

  it('"See who owes" opens Students filtered to Owes fees, across all sessions', async () => {
    await renderFees({ count: 0, owed: 0, bySession: {} });
    expect(screen.getByTestId('kpis')).toBeTruthy();
    const link = screen.getByRole('link', { name: /See who owes/ });
    expect(link.getAttribute('href')).toBe('/dashboard/students?status=owes&scope=all');
    expect(screen.queryByRole('link', { name: /See partial payers/ })).toBeNull();
  });

  it('"See partial payers" shows when someone is on a partial payment', async () => {
    await renderFees({ count: 2, owed: 1500, bySession: {} });
    expect(screen.getByRole('link', { name: /See partial payers/ }).getAttribute('href'))
      .toBe('/dashboard/students?status=partial&scope=all');
  });
});

describe('Setup: two plain sections', () => {
  it('holds Sessions and Class links, each once', async () => {
    vi.doMock('@shared/components/TierGate', passThrough('gate'));
    vi.doMock('@features/dashboard/components/SessionManager', stub('sessions'));
    const { default: SetupTab } = await import('@features/dashboard/tabs/SetupTab');
    render(<MemoryRouter><SetupTab sessions={[]} classLinks={{}} onUpdateLink={() => {}} loading={false} /></MemoryRouter>);
    expect(screen.getAllByTestId('sessions')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: /^Class links$/ })).toBeTruthy();
    expect(screen.queryByText('Essential Setup')).toBeNull();
    vi.doUnmock('@shared/components/TierGate');
    vi.doUnmock('@features/dashboard/components/SessionManager');
  });
});

describe('empty tabs say so', () => {
  it('Approvals: "Nobody is waiting. New registrations will appear here."', async () => {
    const { default: PendingApprovalsPanel } = await import('@features/dashboard/components/PendingApprovalsPanel');
    render(<PendingApprovalsPanel pending={[]} rosters={{}} onApprove={() => {}} onReject={() => {}} loading={false} sessions={[]} />);
    expect(screen.getByText('Nobody is waiting.')).toBeTruthy();
    expect(screen.getByText(/New registrations will appear here\./)).toBeTruthy();
  });

  it('Calendar: "No classes scheduled" in an empty month', async () => {
    vi.doMock('@features/calendar/hooks/useCalendar', () => ({
      useCalendar: () => ({
        month: new Date(2026, 10, 1), goToPreviousMonth() {}, goToNextMonth() {}, goToToday() {},
        occurrences: [], occurrencesByDay: new Map(), calendarEnabled: true, loading: false, saving: false,
        createEvent() {}, updateEvent() {}, deleteEvent() {},
      }),
    }));
    const { default: CalendarPanel } = await import('@features/calendar/components/CalendarPanel');
    render(<CalendarPanel />);
    expect(screen.getByTestId('calendar-empty').textContent).toMatch(/^No classes scheduled this month\. Click a day to add one\.$/);
    vi.doUnmock('@features/calendar/hooks/useCalendar');
  });
});

describe('a tab switch feels instant', () => {
  it('the tab panels do not fade or slide in when they mount', async () => {
    const { readFileSync } = await import('node:fs');
    for (const rel of [
      'src/features/dashboard/components/SessionManager.jsx',
      'src/features/dashboard/components/ClassLinkManager.jsx',
      'src/features/dashboard/components/PendingApprovalsPanel.jsx',
      'src/features/whatsapp/components/WhatsAppPanel.jsx',
      'src/features/calendar/components/CalendarPanel.jsx',
    ]) {
      expect(readFileSync(rel, 'utf8'), rel).not.toMatch(/initial=\{\{ opacity: 0, y: \d+ \}\}/);
    }
  });
});
