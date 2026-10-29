import { useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import { listRetiredNumbers, allowRetiredNumber } from '@services/api/students';
import DuplicatePair from './DuplicatePair';
import { pairsAcross, suffixOf } from '../../duplicates/duplicatePairs';

/**
 * Possible duplicates — 003Fixes / 13. Every pair in the rosters the
 * dashboard already holds (no reads to list them), each with Merge / Decline
 * one / Keep both; and, collapsed at the bottom, the numbers already retired
 * (one request, only when opened) with Allow again. A lazy chunk, opened from
 * the student list's toolbar.
 */
const PAGE = 20;

export default function DuplicatesPanel({ rosters, sessionNames = {}, onClose, showSuccess, showError }) {
  const pairs = useMemo(() => pairsAcross(rosters), [rosters]);
  const sessions = useMemo(() => Object.keys(rosters ?? {}), [rosters]);
  const [retired, setRetired] = useState(null);
  const [retiredOpen, setRetiredOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  // 20 at a time: drawing hundreds of side-by-side cards at once would make
  // opening the panel slow (production has 25 pairs; a big school may have more).
  const [shown, setShown] = useState(PAGE);

  const loadRetired = async () => {
    try {
      setRetired((await listRetiredNumbers(sessions)).retired ?? []);
    } catch (err) {
      setRetired([]);
      showError?.(err?.message ?? 'Could not load retired numbers.');
    }
  };

  const toggleRetired = async () => {
    const next = !retiredOpen;
    setRetiredOpen(next);
    if (next && retired === null) await loadRetired();
  };

  const allow = async (item) => {
    setBusy(`${item.session}/${item.phone}`);
    try {
      await allowRetiredNumber(item.session, item.phone);
      showSuccess?.(`${item.phone} can register again.`, 'Retired numbers');
      setRetired((list) => (list ?? []).filter((x) => !(x.session === item.session && x.phone === item.phone)));
    } catch (err) {
      showError?.(err?.message ?? 'That did not work. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Possible duplicates${pairs.length ? ` (${pairs.length})` : ''}`} onClose={onClose} wide footer={(
      <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close</button>
    )}>
      <p className="small text-muted">
        Registrations with the same name and class, and the same receipt or a number 1–2 digits apart.
        Both numbers keep working until you decide.
      </p>

      {pairs.length === 0 ? (
        <p className="text-muted text-center py-3 mb-3">No possible duplicates.</p>
      ) : (
        pairs.slice(0, shown).map((pair) => (
          <DuplicatePair
            key={`${pair.session}/${pair.key}`}
            session={pair.session}
            pair={pair}
            sessionName={sessions.length > 1 ? (sessionNames[pair.session] ?? pair.session) : null}
            showSuccess={showSuccess}
            showError={showError}
          />
        ))
      )}

      {pairs.length > shown && (
        <button type="button" className="btn btn-sm btn-outline-secondary w-100 mb-3" onClick={() => setShown((n) => n + PAGE)}>
          {`Show ${Math.min(PAGE, pairs.length - shown)} more (${pairs.length - shown} not shown)`}
        </button>
      )}

      <div className="border-top pt-3">
        <button type="button" className="btn btn-sm btn-link px-0" onClick={toggleRetired} aria-expanded={retiredOpen}>
          <i className={`bi ${retiredOpen ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`} aria-hidden="true" />
          Retired numbers{retired?.length ? ` (${retired.length})` : ''}
        </button>
        {retiredOpen && (
          retired === null ? <p className="small text-muted mb-0">Loading…</p>
            : retired.length === 0 ? <p className="small text-muted mb-0">No retired numbers.</p>
              : (
                <ul className="list-unstyled mb-0">
                  {retired.map((item) => (
                    <li key={`${item.session}/${item.phone}`} className="d-flex justify-content-between align-items-center gap-2 py-1" data-testid="retired-item">
                      <span className="small">
                        {item.phone}
                        <span className="text-muted">
                          {' — '}
                          {item.reason === 'merged' ? `merged into ${suffixOf(item.keptSuffix)}` : 'declined as a duplicate'}
                          {sessions.length > 1 ? ` · ${sessionNames[item.session] ?? item.session}` : ''}
                        </span>
                      </span>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => allow(item)} disabled={busy !== null}>
                        Allow again
                      </button>
                    </li>
                  ))}
                </ul>
              )
        )}
      </div>
    </Modal>
  );
}
