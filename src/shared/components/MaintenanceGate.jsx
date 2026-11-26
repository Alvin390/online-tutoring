import { useLocation } from 'react-router-dom';
import { useModes } from '@shared/config/modesStore';

/**
 * 013Fixes / 34: while the superadmin has maintenance on, students and
 * teachers see "Under maintenance" instead of the app. The switch arrives in
 * the bootstrap (no request of its own), or the moment any API answer says
 * `maintenance` (src/services/api/client.js). The superadmin page is never
 * covered, so maintenance can be switched off.
 */

const when = (ms) => new Date(ms).toLocaleString('en-KE', {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
});

export function MaintenanceScreen({ message, until }) {
  return (
    <main className="min-vh-100 d-flex align-items-center justify-content-center p-3 bg-light" data-testid="maintenance-screen">
      <div className="card shadow-sm text-center" style={{ maxWidth: 480, width: '100%' }}>
        <div className="card-body p-4">
          <i className="bi bi-tools display-5 text-warning" aria-hidden="true" />
          <h1 className="h4 mt-3">Under maintenance, back soon</h1>
          {message && <p className="mb-2" data-testid="maintenance-message">{message}</p>}
          {until && <p className="text-muted small mb-0" data-testid="maintenance-until">Expected back: {when(until)}</p>}
        </div>
      </div>
    </main>
  );
}

export default function MaintenanceGate({ children }) {
  const { maintenance } = useModes();
  const { pathname } = useLocation();
  if (maintenance && !pathname.startsWith('/superadmin')) {
    return <MaintenanceScreen message={maintenance.message ?? null} until={maintenance.until ?? null} />;
  }
  return children;
}
