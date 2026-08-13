import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { useAuthState } from '@features/auth/context/AuthContext';
import { SkeletonList } from '@components/ui/Skeleton';
import logger from '@utils/logger';

/**
 * Audit log viewer — Phase 11 D4. Superadmin only.
 *
 * This is what you consult when a teacher disputes a block, a payment or a tier
 * change. It reads `audit/`, which is `allow read: if isSuperadmin()` and
 * `allow write: if false` for every client — **including the superadmin**.
 *
 * That last part is the point: an audit log a privileged user can edit is not
 * an audit log. The viewer is read-only by construction, not by convention,
 * and there is deliberately no delete control anywhere in this component.
 *
 * Entries are already redacted at write time — actors are uids, targets are
 * session/phone paths, and no receipt bodies or credentials are ever recorded.
 */

const ACTION_GROUPS = {
  all: { label: 'Everything', match: () => true },
  access: { label: 'Access decisions', match: (a) => /^student\.|^class\.|^auth\./.test(a) },
  money: { label: 'Money', match: (a) => /^fees\.|^billing\.|^payments\./.test(a) },
  admin: { label: 'Admin & credentials', match: (a) => /^auth\.role|^daraja\.|^session\.|^data\./.test(a) },
};

const TONE = [
  { test: /rejected|failed|locked|mismatch|purged|deleted/, cls: 'text-bg-danger' },
  { test: /granted|approved|received|created/, cls: 'text-bg-success' },
  { test: /changed|updated|reversed/, cls: 'text-bg-warning' },
];

function toneFor(action) {
  return TONE.find((t) => t.test.test(action))?.cls ?? 'text-bg-light text-dark';
}

function formatWhen(value) {
  const ms = value?.toMillis?.() ?? null;
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditLogViewer() {
  const { isSuperadmin } = useAuthState();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!isSuperadmin) {
      setLoading(false);
      return undefined;
    }

    const q = query(collection(db, 'audit'), orderBy('at', 'desc'), limit(200));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        logger.error('Audit log listener failed', error);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [isSuperadmin]);

  const filtered = useMemo(() => {
    const matcher = ACTION_GROUPS[group].match;
    const term = search.trim().toLowerCase();

    return entries.filter((entry) => {
      if (!matcher(entry.action ?? '')) return false;
      if (!term) return true;
      return (
        (entry.action ?? '').toLowerCase().includes(term)
        || (entry.actor ?? '').toLowerCase().includes(term)
        || (entry.target ?? '').toLowerCase().includes(term)
      );
    });
  }, [entries, group, search]);

  /** CSV export, for handing a dispute to someone outside the app. */
  const exportCsv = useCallback(() => {
    const rows = [
      ['when', 'action', 'actor', 'actorRole', 'target'],
      ...filtered.map((e) => [
        formatWhen(e.at),
        e.action ?? '',
        e.actor ?? '',
        e.actorRole ?? '',
        e.target ?? '',
      ]),
    ];

    // Quote every field and escape embedded quotes — a target path or reason
    // containing a comma would otherwise shift every column after it.
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [filtered]);

  if (!isSuperadmin) {
    return (
      <div className="alert alert-secondary" role="status">
        The audit log is available to the superadmin account only.
      </div>
    );
  }

  return (
    <div className="card mb-4">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">
          <i className="bi bi-shield-check me-2" aria-hidden="true" />
          Audit log
        </h5>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          <i className="bi bi-download me-1" aria-hidden="true" />
          Export CSV
        </button>
      </div>

      <div className="card-body">
        <div className="row g-2 mb-3">
          <div className="col-md-5">
            <label className="visually-hidden" htmlFor="audit-group">Filter by type</label>
            <select
              id="audit-group"
              className="form-select form-select-sm"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {Object.entries(ACTION_GROUPS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="col-md-7">
            <label className="visually-hidden" htmlFor="audit-search">Search</label>
            <input
              id="audit-search"
              type="search"
              className="form-control form-control-sm"
              placeholder="Search action, actor or target…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading && <SkeletonList rows={5} />}

        {!loading && filtered.length === 0 && (
          <p className="text-muted text-center py-3 mb-0">
            {entries.length === 0
              ? 'No audit entries yet. Every block, approval, payment and tier change will appear here.'
              : 'Nothing matches that filter.'}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Target</th>
                  <th scope="col"><span className="visually-hidden">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-nowrap small">{formatWhen(entry.at)}</td>
                    <td>
                      <span className={`badge ${toneFor(entry.action ?? '')}`}>
                        {entry.action ?? 'unknown'}
                      </span>
                    </td>
                    <td className="small font-monospace">
                      {entry.actor ?? '—'}
                      {entry.actorRole && (
                        <span className="text-muted"> ({entry.actorRole})</span>
                      )}
                    </td>
                    <td className="small font-monospace text-break">{entry.target ?? '—'}</td>
                    <td>
                      {(entry.before || entry.after || entry.context) && (
                        <button
                          className="btn btn-link btn-sm p-0"
                          onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                          aria-expanded={expanded === entry.id}
                        >
                          {expanded === entry.id ? 'Hide' : 'Details'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expanded && (
              <pre
                className="bg-light rounded p-2 small mt-2 mb-0"
                style={{ maxHeight: 240, overflow: 'auto' }}
              >
                {JSON.stringify(
                  filtered.find((e) => e.id === expanded),
                  (key, value) => (key === 'at' ? undefined : value),
                  2
                )}
              </pre>
            )}
          </div>
        )}

        <p className="small text-muted mt-3 mb-0">
          Read-only. Audit entries are written by the server and cannot be edited or
          deleted by any account, including this one.
        </p>
      </div>
    </div>
  );
}
