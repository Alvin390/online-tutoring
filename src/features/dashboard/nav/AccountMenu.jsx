import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/routes/routeConfig';

// Lazy, as from the Help button: the form and its screenshot pipeline cost
// nothing until a teacher opens it. Held HERE, not inside the menu list, so
// closing the menu does not close the form.
const HelpFeedbackModal = lazy(() => import('@features/reports/components/HelpFeedbackModal'));

/**
 * The account menu — 007Fixes / 03 (owner: Billing, Help and Logout in an
 * account menu). Refresh, the signed-in email, Billing (its own page),
 * Help & feedback, Logout. Closes on Escape, on an outside click, and after
 * choosing.
 */
export default function AccountMenu({ email, onRefresh, refreshing = false, onLogout }) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const choose = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="dashboard-account position-relative" ref={rootRef}>
      <button
        type="button"
        className="btn btn-light btn-sm d-flex align-items-center gap-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <i className="bi bi-person-circle fs-5" aria-hidden="true" />
        {/* Wide screens only (007Fixes / 10): seven tabs need the room; the
            email is also in the menu ("Signed in as …"). */}
        <span className="dashboard-account-email text-truncate" style={{ maxWidth: '14rem' }}>{email}</span>
        <i className="bi bi-chevron-down small" aria-hidden="true" />
      </button>

      {open && (
        <div className="dashboard-account-menu dropdown-menu dropdown-menu-end show shadow" role="menu">
          {email && (
            <div className="px-3 py-2 small text-muted border-bottom text-truncate">
              Signed in as <span className="fw-semibold text-body">{email}</span>
            </div>
          )}
          <button type="button" role="menuitem" className="dropdown-item" onClick={choose(onRefresh)} disabled={refreshing}>
            <i className={`bi bi-arrow-clockwise me-2 ${refreshing ? 'spin' : ''}`} aria-hidden="true" />Refresh
          </button>
          <button type="button" role="menuitem" className="dropdown-item" onClick={choose(() => navigate(ROUTES.BILLING))}>
            <i className="bi bi-credit-card me-2" aria-hidden="true" />Billing
          </button>
          <button type="button" role="menuitem" className="dropdown-item" onClick={choose(() => setHelpOpen(true))}>
            <i className="bi bi-life-preserver me-2" aria-hidden="true" />Help &amp; feedback
          </button>
          <div className="dropdown-divider" />
          <button type="button" role="menuitem" className="dropdown-item text-danger" onClick={choose(onLogout)}>
            <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />Logout
          </button>
        </div>
      )}

      {helpOpen && (
        <Suspense fallback={null}>
          <HelpFeedbackModal onClose={() => setHelpOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
