import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

/**
 * 007Fixes / 03: the dashboard in tabs (owner, 2026-11-11).
 *
 * The real DashboardLayout with its data hook and the panels stubbed: what is
 * tested is the frame — the addresses, which tabs show, the banner, the
 * account menu, and above all that the data hook (the Firestore listeners)
 * lives in the frame and is never restarted by a tab switch.
 */

const hook = { mounts: 0, unmounts: 0 };
let flags;
let flagsLoaded;
let auth;
let pending;

function stubs() {
  vi.doMock('@features/dashboard/hooks/useDashboard', () => ({
    useDashboard: () => {
      useEffect(() => {
        hook.mounts += 1;
        return () => { hook.unmounts += 1; };
      }, []);
      return {
        studentsBySession: { morning: [{ id: '+254711000001', studentName: 'Amina' }] },
        sessions: [{ id: 'morning', name: 'Morning', active: true, schedule: null }],
        tabs: [{ id: 'morning', name: 'Morning', active: true }],
        pendingApprovals: pending,
        classLinks: {},
        loading: false,
        activeTab: 'morning',
        setActiveTab: vi.fn(),
        totalStudents: 1,
      };
    },
  }));
  vi.doMock('@features/auth/context/AuthContext', () => ({
    useAuthState: () => auth,
    useAuthActions: () => ({ signOut: auth.signOut }),
  }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (key) => flags[key] === true, useFlags: () => flags, useFlagsLoaded: () => flagsLoaded }));
  vi.doMock('@hooks/useIdleTimeout', () => ({ default: () => ({ warning: false, msRemaining: 0, reset: vi.fn() }) }));
  const panel = (name) => () => ({ default: () => <div data-testid={`panel-${name}`}>{name}</div> });
  vi.doMock('@features/dashboard/components/StudentSearchPanel', panel('students'));
  vi.doMock('@features/dashboard/components/StatsCards', panel('stats'));
  vi.doMock('@features/dashboard/components/PendingApprovalsPanel', panel('approvals'));
  vi.doMock('@features/fees/components/FeeKpiCards', panel('fees'));
  vi.doMock('@features/whatsapp/components/WhatsAppPanel', panel('whatsapp'));
  vi.doMock('@features/calendar/components/CalendarPanel', panel('calendar'));
  vi.doMock('@features/dashboard/components/SessionManager', panel('sessions'));
  vi.doMock('@features/dashboard/components/ClassLinkManager', panel('links'));
  vi.doMock('@features/reports/components/HelpFeedbackModal', () => ({ default: () => <div role="dialog">help form</div> }));
}

let probe;
function Probe() {
  probe = { location: useLocation(), navigate: useNavigate() };
  return null;
}

async function open(url) {
  const { default: DashboardLayout } = await import('@features/dashboard/components/DashboardLayout');
  render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <Routes>
        <Route path="/dashboard/*" element={<DashboardLayout />} />
        <Route path="/billing" element={<div>billing page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
const nav = () => screen.getByRole('navigation', { name: 'Dashboard' });
const clickTab = async (name) => {
  await act(async () => { fireEvent.click(within(nav()).getByRole('link', { name: new RegExp(`^${name}`) })); });
};

beforeEach(() => {
  vi.resetModules();
  hook.mounts = 0;
  hook.unmounts = 0;
  pending = [];
  flagsLoaded = true;
  flags = {
    'registration.requireApproval': true, 'fees.enabled': true, 'whatsapp.broadcast': true, 'calendar.enabled': true,
  };
  auth = { user: { email: 'teacher@school.test' }, tierRank: 3, isSuperadmin: false, signOut: vi.fn() };
  stubs();
});
afterEach(() => { cleanup(); vi.resetModules(); });

describe('addresses', () => {
  it('/dashboard opens Students, keeping any filter in the address', async () => {
    await open('/dashboard?status=owes');
    expect(await screen.findByTestId('panel-students')).toBeTruthy();
    expect(probe.location.pathname).toBe('/dashboard/students');
    expect(probe.location.search).toBe('?status=owes');
  });

  it('an unknown tab opens Students', async () => {
    await open('/dashboard/nonsense');
    expect(await screen.findByTestId('panel-students')).toBeTruthy();
    expect(probe.location.pathname).toBe('/dashboard/students');
  });

  it('each tab shows only its own content, and marks itself current', async () => {
    await open('/dashboard/students');
    for (const [name, panel] of [['Approvals', 'approvals'], ['Fees', 'fees'], ['WhatsApp', 'whatsapp'], ['Calendar', 'calendar'], ['Setup', 'sessions']]) {
      await clickTab(name);
      expect(await screen.findByTestId(`panel-${panel}`)).toBeTruthy();
      expect(screen.queryByTestId('panel-students')).toBeNull();
      expect(within(nav()).getByRole('link', { name: new RegExp(`^${name}`) }).getAttribute('aria-current')).toBe('page');
    }
    expect(screen.getByTestId('panel-links')).toBeTruthy(); // Setup holds both
  });
});

describe('the data stays in the frame', () => {
  it('switching through every tab never restarts the data hook (no listener is re-subscribed)', async () => {
    await open('/dashboard/students');
    await screen.findByTestId('panel-students');
    expect(hook.mounts).toBe(1);
    for (const name of ['Approvals', 'Fees', 'WhatsApp', 'Calendar', 'Setup', 'Students']) {
      await clickTab(name);
      await screen.findByRole('navigation', { name: 'Dashboard' });
    }
    expect(hook.mounts).toBe(1);
    expect(hook.unmounts).toBe(0);
  });

  it('a filter survives going to Fees and back', async () => {
    await open('/dashboard/students?status=owes&q=ann');
    await screen.findByTestId('panel-students');
    await clickTab('Fees');
    await screen.findByTestId('panel-fees');
    await act(async () => { probe.navigate(-1); });
    expect(await screen.findByTestId('panel-students')).toBeTruthy();
    expect(probe.location.pathname).toBe('/dashboard/students');
    expect(probe.location.search).toBe('?status=owes&q=ann');
  });
});

describe('which tabs show', () => {
  it('a flag that is off hides its tab, and its address opens Students', async () => {
    flags['calendar.enabled'] = false;
    flags['registration.requireApproval'] = false;
    await open('/dashboard/calendar');
    expect(await screen.findByTestId('panel-students')).toBeTruthy();
    expect(probe.location.pathname).toBe('/dashboard/students');
    const names = within(nav()).getAllByRole('link').map((a) => a.textContent.trim());
    expect(names).toEqual(['Students', 'Fees', 'WhatsApp', 'Staff', 'Setup']); // 007Fixes / 10: Staff is always shown
  });

  // Release A browser pass: a refresh on Approvals sometimes landed on
  // Students. The flags render as their defaults (off) until the server's
  // answer, and the frame redirected in that moment, with `replace`.
  it('a refresh on a flag-gated tab waits for the flags instead of leaving it', async () => {
    flagsLoaded = false;
    flags['registration.requireApproval'] = false; // the default, before the answer
    await open('/dashboard/approvals');
    await act(async () => {});
    expect(probe.location.pathname).toBe('/dashboard/approvals');
    expect(screen.queryByTestId('panel-students')).toBeNull();
  });

  it('a tier too low shows the upgrade prompt inside the tab', async () => {
    auth.tierRank = 1;
    await open('/dashboard/fees');
    expect(await screen.findByRole('link', { name: /Upgrade to Silver/ })).toBeTruthy();
    expect(screen.queryByTestId('panel-fees')).toBeNull();
  });
});

describe('students waiting', () => {
  it('a banner on every tab but Approvals, with the count, and a badge on Approvals', async () => {
    pending = [{ id: '+254711000002', session: 'morning' }, { id: '+254711000003', session: 'morning' }];
    await open('/dashboard/students');
    expect((await screen.findByTestId('waiting-banner')).textContent).toMatch(/2 students waiting/);
    expect(within(nav()).getByRole('link', { name: /^Approvals/ }).textContent).toMatch(/2/);
    await clickTab('Fees');
    expect(screen.getByTestId('waiting-banner')).toBeTruthy();
    await clickTab('Approvals');
    expect(screen.queryByTestId('waiting-banner')).toBeNull();
  });

  it('no banner when nobody waits', async () => {
    await open('/dashboard/students');
    await screen.findByTestId('panel-students');
    expect(screen.queryByTestId('waiting-banner')).toBeNull();
  });
});

describe('the account menu', () => {
  it('holds Refresh, Billing, Help & feedback and Logout', async () => {
    await open('/dashboard/students');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Account menu' })); });
    const items = screen.getAllByRole('menuitem').map((b) => b.textContent.trim());
    expect(items).toEqual(['Refresh', 'Billing', 'Help & feedback', 'Logout']);

    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Help & feedback/ })); });
    expect(await screen.findByRole('dialog')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Account menu' })); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ })); });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('Billing goes to the billing page', async () => {
    await open('/dashboard/students');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Account menu' })); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Billing/ })); });
    expect(await screen.findByText('billing page')).toBeTruthy();
  });
});

describe('Sentry page tags', () => {
  it('every tab is the dashboard page, with a low-cardinality tab tag', async () => {
    vi.doUnmock('@shared/config/FlagsContext');
    const { routeTag, dashboardTabTag } = await import('@shared/utils/monitoring');
    expect(routeTag('/dashboard')).toBe('dashboard');
    expect(routeTag('/dashboard/fees')).toBe('dashboard');
    expect(routeTag('/dashboard/fees/')).toBe('dashboard');
    expect(routeTag('/morning')).toBe('session-page');
    expect(dashboardTabTag('/dashboard/fees')).toBe('fees');
    expect(dashboardTabTag('/dashboard/+254711000001')).toBe('other');
    expect(dashboardTabTag('/dashboard')).toBe('other');
    expect(dashboardTabTag('/morning')).toBeUndefined();
  });
});
