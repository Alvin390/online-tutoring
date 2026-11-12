import { NavLink } from 'react-router-dom';
import AccountMenu from './AccountMenu';
import { tabPath } from './dashboardTabs';

/**
 * The dashboard's top bar — 007Fixes / 03. Brand, the tabs, the account menu.
 *
 * Phase 13 / 07 rule kept: never wider than a phone. The tab strip scrolls
 * sideways inside the bar rather than widening the page (a page wider than
 * the screen puts every fixed overlay off-centre).
 */
export default function DashboardNav({ tabs, waitingCount = 0, email, onRefresh, refreshing, onLogout, onPrefetch }) {
  return (
    <header className="dashboard-header dashboard-nav text-white sticky-top">
      <div className="container-fluid d-flex align-items-center gap-2 gap-md-3 py-2">
        <div className="d-flex align-items-center gap-2 flex-shrink-0">
          <i className="bi bi-speedometer2 fs-4" aria-hidden="true" />
          {/* Wide screens only: on a tablet the six tabs need the room. */}
          <span className="fw-bold d-none d-xl-inline">Teacher Dashboard</span>
        </div>

        <nav className="dashboard-nav-tabs flex-grow-1" aria-label="Dashboard">
          <ul className="nav flex-nowrap">
            {tabs.map((tab) => (
              <li className="nav-item" key={tab.id}>
                <NavLink
                  to={tabPath(tab.id)}
                  className={({ isActive }) => `nav-link dashboard-nav-link text-nowrap ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => onPrefetch?.(tab.id)}
                  onFocus={() => onPrefetch?.(tab.id)}
                >
                  <i className={`bi ${tab.icon} me-1`} aria-hidden="true" />
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
