import { NavLink, useLocation } from 'react-router-dom';
import AccountMenu from './AccountMenu';
import { tabPath, tabFromPath } from './dashboardTabs';

/**
 * The dashboard's top bar — 007Fixes / 03. Brand, the tabs, the account menu.
 *
 * Phase 13 / 07 rule kept: never wider than a phone. The tab strip scrolls
 * sideways inside the bar rather than widening the page (a page wider than
 * the screen puts every fixed overlay off-centre).
 *
 * Below 768 px (007Fixes / 04) the tabs move to the bottom bar (BottomNav);
 * this bar shows the current tab's name and the account menu.
 */
export default function DashboardNav({ tabs, waitingCount = 0, email, onRefresh, refreshing, onLogout, onPrefetch }) {
  const { pathname } = useLocation();
  const current = tabs.find((tab) => tab.id === tabFromPath(pathname));
  return (
    <header className="dashboard-header dashboard-nav text-white sticky-top">
      <div className="container-fluid dashboard-nav-inner d-flex align-items-center gap-2 gap-md-3">
        <div className="d-flex align-items-center gap-2 flex-shrink-0">
          <i className="bi bi-speedometer2 fs-4 dashboard-nav-brand-icon" aria-hidden="true" />
          {/* Wide screens only: on a tablet the six tabs need the room. */}
          <span className="fw-bold fs-5 d-none d-xl-inline">Teacher Dashboard</span>
        </div>

        <h1 className="dashboard-nav-title d-md-none flex-grow-1 text-truncate h5 fw-bold mb-0">
          {current?.label ?? 'Dashboard'}
        </h1>

        <nav className="dashboard-nav-tabs flex-grow-1 d-none d-md-block" aria-label="Dashboard">
          <ul className="nav flex-nowrap">
            {tabs.map((tab) => (
              <li className="nav-item" key={tab.id}>
                <NavLink
                  to={tabPath(tab.id)}
                  className={({ isActive }) => `nav-link dashboard-nav-link text-nowrap ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => onPrefetch?.(tab.id)}
                  onFocus={() => onPrefetch?.(tab.id)}
                >
                  <i className={`bi ${tab.icon} me-2`} aria-hidden="true" />
                  {tab.label}
                  {tab.id === 'approvals' && waitingCount > 0 && (
                    <span className="badge rounded-pill text-bg-warning ms-1" aria-label={`${waitingCount} waiting`}>
                      {waitingCount}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <AccountMenu email={email} onRefresh={onRefresh} refreshing={refreshing} onLogout={onLogout} />
      </div>
    </header>
  );
}
