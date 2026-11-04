import { useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import { formatKes } from '@utils/blockReason';
import { runBulk, BulkInterrupted } from '@services/api/students';
import { plural } from '../../bulk/bulkText';

/**
 * Delete a selection of students — 006Fixes / 02 (owner, 4 Nov 2026).
 * A lazy chunk, prefetched when the browser is idle.
 *
 * It can't be undone, so it says exactly who and what they owe, and the
 * button only works once the teacher types DELETE (the server checks it too).
 * Each student is removed as the single delete removes one: the record and
 * notes go, the payment history stays, any balance is closed.
 */
const SHOWN = 5;
export const CONFIRM_WORD = 'DELETE';

/** Who is being deleted, and what they owe — from the rows already loaded. */
export function planDelete(rows) {
  const owing = rows.filter((r) => (Number(r.feeBalance) || 0) > 0);
  return {
    shown: rows.slice(0, SHOWN),
    more: Math.max(0, rows.length - SHOWN),
    owingCount: owing.length,
    owingTotal: owing.reduce((sum, r) => sum + (Number(r.feeBalance) || 0), 0),
  };
}

export default function BulkDeleteModal({ rows, sessionOf, sessionNames = {}, onClose, onDone }) {
  const plan = useMemo(() => planDelete(rows), [rows]);
  const [typed, setTyped] = useState('');
  const [step, setStep] = useState('confirm');
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: rows.length });
  const [partial, setPartial] = useState(null);
  const n = rows.length;
  const confirmed = typed.trim() === CONFIRM_WORD;

  const start = async (resume = null) => {
    setError(null);
    setStep('running');
    try {
      const result = await runBulk({
        action: 'delete',
        items: rows.map((row) => ({ session: sessionOf(row), phone: row.id })),
        onProgress: (done, total) => setProgress({ done, total }),
        resume,
      });
      onDone({ ...result, action: 'delete' });
    } catch (err) {
      if (err instanceof BulkInterrupted) {
        setPartial(err.partial);
        setStep('interrupted');
      } else {
        setError(err?.message ?? 'Nothing was deleted. Please try again.');
        setStep('confirm');
      }
    }
  };

  if (step === 'running' || step === 'interrupted') {
    const footer = step === 'interrupted' ? (
      <>
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-danger" onClick={() => start(partial)}>Continue</button>
      </>
    ) : null;
    return (
      <Modal title={`Delete ${plural(n, 'student')}`} onClose={step === 'running' ? () => {} : onClose} footer={footer}>
        {step === 'running' ? (
          <div className="text-center py-3" role="status" aria-live="polite" data-testid="bulk-progress">
            <span className="spinner-border spinner-border-sm text-danger me-2" aria-hidden="true" />
            Deleting… {progress.done} of {progress.total}
          </div>
        ) : (
          <div className="alert alert-warning mb-0" role="alert" data-testid="bulk-interrupted">
            The connection dropped after {partial?.next ?? 0} of {partial?.total ?? n}. Those are deleted.
            Continue to finish the remaining {(partial?.total ?? n) - (partial?.next ?? 0)}.
          </div>
        )}
      </Modal>
    );
  }

  const footer = (
    <>
      <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-danger" onClick={() => start()} disabled={!confirmed}>
        Delete {plural(n, 'student')}
      </button>
    </>
  );
  return (
    <Modal title={`Delete ${plural(n, 'student')}?`} onClose={onClose} footer={footer} type="danger">
      <div data-testid="bulk-delete-confirm">
        <div className="mb-2 small" data-testid="bulk-delete-who">
          {plan.shown.map((row) => (
            <div key={`${sessionOf(row)}/${row.id}`}>
              <strong>{row.studentName || 'No name'}</strong>
              <span className="text-muted"> · {sessionNames[sessionOf(row)] ?? sessionOf(row)} · {row.class || 'No class'}</span>
            </div>
          ))}
          {plan.more > 0 && <div className="text-muted">and {plan.more} more</div>}
        </div>
        {plan.owingCount > 0 && (
          <p className="mb-2 small fw-semibold" data-testid="bulk-delete-money">
            {plan.owingCount === 1 ? '1 of them owes' : `${plan.owingCount} of them owe`} {formatKes(plan.owingTotal)}. Deleting closes {plan.owingCount === 1 ? 'this balance' : 'these balances'}, and they no longer count in Total outstanding.
          </p>
        )}
        <div className="alert alert-danger py-2 small" data-testid="bulk-delete-warning">
          This can&apos;t be undone. Their records and your private notes about them are removed for good. Their payment history is kept.
        </div>
        <label htmlFor="bulk-delete-typed" className="form-label small fw-semibold mb-1">
          Type {CONFIRM_WORD} to confirm
        </label>
        <input
          id="bulk-delete-typed"
          className="form-control"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
        {error && <div className="alert alert-danger mt-3 mb-0 small">{error}</div>}
      </div>
    </Modal>
  );
}
