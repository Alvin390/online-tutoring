import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/routes/routeConfig';
import { tabPath, tabFromPath } from './dashboardTabs';

// Lazy, as in the account menu: nothing to download until it is opened.
const HelpFeedbackModal = lazy(() => import('@features/reports/components/HelpFeedbackModal'));

const BAR_SLOTS = 4;
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable="true"]';

/**
 * The phone bottom bar — 007Fixes / 04 (owner, 2026-11-11). Shown below
 * 768 px only (CSS); the top bar keeps the tabs on wider screens.
 *
 * The first four visible tabs (Students, Approvals, Fees, WhatsApp) sit in the
 * bar; the rest, Billing, Help & feedback and Logout are under More, a bottom
 * sheet within thumb reach. A tab whose flag is off drops out and the next
 * moves in.
 *
 * Marks <body> with `has-bottom-nav` so the content, the selection bar and the
 * toasts are laid out above it (the stacking rule in index.css /
 * dashboard.css), and with `is-typing` while a text field has focus, so the
 * bar does not ride up over the field on top of the on-screen keyboard.
 */
export default function BottomNav({ tabs, waitingCount = 0, onLogout }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const sheetRef = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const inBar = tabs.slice(0, BAR_SLOTS);
  const inMore = tabs.slice(BAR_SLOTS);
  const current = tabFromPath(pathname);
  const moreActive = inMore.some((tab) => tab.id === current);

  useEffect(() => {
    const body = document.body;
    body.classList.add('has-bottom-nav');
    const onFocusIn = (e) => { if (e.target?.matches?.(TYPING)) body.classList.add('is-typing'); };
    const onFocusOut = () => body.classList.remove('is-typing');
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      body.classList.remove('has-bottom-nav', 'is-typing');
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return undefined;
    sheetRef.current?.querySelector('.list-group a, .list-group button')?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const close = () => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  };
  const choose = (fn) => () => { setMoreOpen(false); fn(); };

  return (
    <>
      <nav className="dashboard-bottom-nav d-md-none" aria-label="Dashboard sections">
        {inBar.map((tab) => (
          <NavLink
            key={tab.id}
            to={tabPath(tab.id)}
            data-tab={tab.id}
            className={({ isActive }) => `dashboard-bottom-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="dashboard-bottom-nav-icon">
              <i className={`bi ${tab.icon}`} aria-hidden="true" />
              {tab.id === 'approvals' && waitingCount > 0 && (
                <span className="badge rounded-pill text-bg-warning" aria-label={`${waitingCount} waiting`}>
                  {waitingCount > 99 ? '99+' : waitingCount}
                </span>
              )}
            </span>
            <span className="dashboard-bottom-nav-label">{tab.label}</span>
          </NavLink>
        ))}
        <button
          ref={moreButtonRef}
          type="button"
          className={`dashboard-bottom-nav-item ${moreActive || moreOpen ? 'active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className="dashboard-bottom-nav-icon"><i className="bi bi-three-dots" aria-hidden="true" /></span>
          <span className="dashboard-bottom-nav-label">More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="dashboard-sheet-backdrop d-md-none" onClick={close} aria-hidden="true" />
          <div
            ref={sheetRef}
            className="dashboard-sheet d-md-none"
            role="dialog"
            aria-modal="true"
            aria-label="More"
          >
            <div className="d-flex align-items-center justify-content-between px-3 pt-3 pb-2">
              <span className="fw-semibold">More</span>
              <button type="button" className="btn-close" aria-label="Close" onClick={close} />
            </div>
            <div className="list-group list-group-flush">
              {inMore.map((tab) => (
                <NavLink
                  key={tab.id}
                  to={tabPath(tab.id)}
                  className={({ isActive }) => `list-group-item list-group-item-action dashboard-sheet-item ${isActive ? 'active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <i className={`bi ${tab.icon} me-3`} aria-hidden="true" />{tab.label}
                </NavLink>
              ))}
              <button type="button" className="list-group-item list-group-item-action dashboard-sheet-item" onClick={choose(() => navigate(ROUTES.BILLING))}>
                <i className="bi bi-credit-card me-3" aria-hidden="true" />Billing
              </button>
              <button type="button" className="list-group-item list-group-item-action dashboard-sheet-item" onClick={choose(() => setHelpOpen(true))}>
                <i className="bi bi-life-preserver me-3" aria-hidden="true" />Help &amp; feedback
              </button>
              <button type="button" className="list-group-item list-group-item-action dashboard-sheet-item text-danger" onClick={choose(onLogout)}>
                <i className="bi bi-box-arrow-right me-3" aria-hidden="true" />Logout
              </button>
            </div>
          </div>
        </>
      )}

      {helpOpen && (
        <Suspense fallback={null}>
          <HelpFeedbackModal onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
