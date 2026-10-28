import { useCallback, useEffect, useState } from 'react';
import Modal from '@components/ui/Modal';
import { listBulkActions, undoBulk, listBulkItems } from '@services/api/students';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useFlag } from '@shared/config/FlagsContext';
import { setWhatsappPreset, blockedParentsDraft } from '@features/whatsapp/whatsappPreset';
import { formatKes } from '@utils/blockReason';
import { formatTime } from '@utils/dates';
import { replaceRecent, markUndone } from '../../bulk/recentBulk';
import { BULK_TEXT } from '../../bulk/bulkText';

/**
 * Recent actions — 003Fixes / 05. The bulk actions of the last 30 minutes,
 * each with Undo while its window is open. Fetched from the server when
 * opened, so it survives a reload and shows actions done on another device.
 * A lazy chunk, opened from the student list's toolbar.
 */
const minutesLeft = (until, now) => Math.max(0, Math.ceil((until - now) / 60_000));

function describe(action) {
  const text = BULK_TEXT[action.action] ?? BULK_TEXT.block;
  const done = action.counts?.done ?? 0;
  const what = `${text.past[0].toUpperCase()}${text.past.slice(1)} ${done} student${done === 1 ? '' : 's'}`;
  if (action.action !== 'block') return what;
  if (action.kind === 'fees' && action.amount) return `${what} · unpaid fees ${formatKes(action.amount)}`;
  return action.reason ? `${what} · “${action.reason}”` : what;
}

export default function RecentActionsPanel({ onClose, showSuccess, showError }) {
  const [actions, setActions] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [working, setWorking] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  // 003Fixes / 09: messaging chosen students is Gold + whatsapp.advanced, as in the WhatsApp panel.
  const { tierRank, isSuperadmin } = useAuthState();
  const broadcast = useFlag('whatsapp.broadcast');
  const advanced = useFlag('whatsapp.advanced');
  const canMessage = broadcast && advanced && (isSuperadmin || (tierRank ?? 0) >= 3);
  const [preparing, setPreparing] = useState(null);

  const messageParents = async (action) => {
    setPreparing(action.id);
    try {
      const { items } = await listBulkItems(action.id);
      setWhatsappPreset({
        title: `Blocked students — ${formatTime(new Date(action.createdAtMs))}`,
        template: blockedParentsDraft({ kind: action.kind }),
        filterValues: items.map((i) => `${i.session}:${i.phone}`),
        note: 'of the students blocked by this action',
      });
      onClose();
    } catch (err) {
      showError?.(err?.message ?? 'Could not prepare the message.');
    } finally {
      setPreparing(null);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listBulkActions();
      setActions(res.actions ?? []);
      replaceRecent(res.actions ?? []);
    } catch (err) {
      setError(err?.message ?? 'Could not load recent actions.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const undo = async (action) => {
    setConfirming(null);
    setWorking({ id: action.id, done: 0 });
    try {
      const res = await undoBulk(action.id, (done) => setWorking({ id: action.id, done }));
      markUndone(action.id);
      showSuccess?.(
        `${res.undone} student${res.undone === 1 ? '' : 's'} put back as they were.`
        + (res.changedSince ? ` ${res.changedSince} had changed since and were left as they are.` : ''),
        'Undone'
      );
      await load();
    } catch (err) {
      showError?.(err?.message ?? 'Could not undo that.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <Modal title="Recent actions" onClose={working ? () => {} : onClose} footer={(
      <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={Boolean(working)}>Close</button>
    )}>
      <p className="small text-muted">Bulk actions from the last 30 minutes. Undo puts every student back as they were, except anyone who has changed since (for example, paid).</p>
      {error && (
        <div className="alert alert-warning small">
          {error}{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={load}>Try again</button>
        </div>
      )}
      {actions === null && !error && <p className="text-center text-muted small py-3">Loading…</p>}
      {actions?.length === 0 && <p className="text-center text-muted small py-3" data-testid="recent-empty">Nothing in the last 30 minutes.</p>}
      <ul className="list-group" data-testid="recent-actions">
        {(actions ?? []).map((a) => {
          const left = minutesLeft(a.undoUntilMs, now);
          const canUndo = a.status === 'done' && left > 0 && (a.counts?.done ?? 0) > 0;
          return (
            <li key={a.id} className="list-group-item" data-testid="recent-action">
              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold small">{describe(a)}</div>
                  <div className="text-muted small">
                    {formatTime(new Date(a.createdAtMs))}
                    {a.status === 'undone' && ' · undone'}
                    {a.status === 'done' && (left > 0 ? ` · ${left} min left to undo` : ' · too late to undo')}
                  </div>
                </div>
                {canMessage && a.action === 'block' && (a.counts?.done ?? 0) > 0 && (
                  <button type="button" className="btn btn-sm btn-outline-success" onClick={() => messageParents(a)} disabled={Boolean(working) || preparing === a.id}>
                    <i className="bi bi-whatsapp me-1" aria-hidden="true" />WhatsApp parents
                  </button>
                )}
                {canUndo && confirming !== a.id && working?.id !== a.id && (
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setConfirming(a.id)} disabled={Boolean(working)}>
                    <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />Undo
                  </button>
                )}
              </div>
              {confirming === a.id && (
                <div className="mt-2 small" role="group" aria-label="Confirm undo">
                  Put these {a.counts?.done ?? 0} students back as they were?{' '}
                  <button type="button" className="btn btn-sm btn-danger ms-1" onClick={() => undo(a)}>Yes, undo</button>{' '}
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirming(null)}>Keep</button>
                </div>
              )}
              {working?.id === a.id && (
                <div className="mt-2 small" role="status" aria-live="polite">
                  <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />
                  Undoing… {working.done} of {a.counts?.done ?? 0}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
