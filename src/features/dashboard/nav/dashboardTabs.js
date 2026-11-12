/**
 * The dashboard's tabs — 007Fixes / 03.
 *
 * The teacher's dashboard was one long page; she scrolled past the calendar and
 * the money cards to reach her students. Owner (2026-11-11): tabs, each filling
 * the screen, in this order, one address each (`/dashboard/<tab>`).
 *
 * Ruling (007Fixes overview): a tab whose feature flag is OFF is hidden; a tab
 * whose flag is on but whose tier is too low still shows, with the upgrade
 * prompt inside (TierGate), as the panels always did.
 */
export const DASHBOARD_BASE = '/dashboard';

export const DASHBOARD_TABS = Object.freeze([
  { id: 'students', label: 'Students', icon: 'bi-people-fill' },
  { id: 'approvals', label: 'Approvals', icon: 'bi-person-check-fill', flag: 'registration.requireApproval' },
  { id: 'fees', label: 'Fees', icon: 'bi-cash-coin', flag: 'fees.enabled' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'bi-whatsapp', flag: 'whatsapp.broadcast' },
  { id: 'calendar', label: 'Calendar', icon: 'bi-calendar3', flag: 'calendar.enabled' },
  { id: 'setup', label: 'Setup', icon: 'bi-gear-fill' },
]);

export const DEFAULT_TAB = 'students';

/** The tabs this school sees, in order. `isOn(flag)` reads a feature flag. */
export function visibleTabs(isOn) {
  return DASHBOARD_TABS.filter((tab) => !tab.flag || isOn(tab.flag) === true);
}

export const tabPath = (id) => `${DASHBOARD_BASE}/${id}`;

/** The tab named in a dashboard address, or null (`/dashboard`, unknown, elsewhere). */
export function tabFromPath(pathname = '') {
  const match = /^\/dashboard\/([a-z]+)\/?$/.exec(String(pathname).toLowerCase());
  return match && DASHBOARD_TABS.some((tab) => tab.id === match[1]) ? match[1] : null;
}
