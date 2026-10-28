import { useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import BlockForm from '../block/BlockForm';
import { useFlag } from '@shared/config/FlagsContext';
import { useAuthState } from '@features/auth/context/AuthContext';
import { TIER_RANK } from '@shared/constants/tiers';
import { effectiveApprovalStatus } from '@/shared/utils/studentState';
import { formatKes } from '@utils/blockReason';
import { runBulk, runSchedule, removeFromSchedule, BulkInterrupted } from '@services/api/students';
import { useBlockWhen } from '../../bulk/useBlockWhen';
import { formatWhen } from '../../bulk/scheduleTime';
import { BULK_TEXT, describeSkipped, plural } from '../../bulk/bulkText';

/**
 * Block / unblock / approve receipts for a selection — 003Fixes / 05 and 06.
 * A lazy chunk: loaded when the teacher presses the selection bar's button.
 *
 *   form (block only) → confirm (counts per class, who is skipped and why)
 *   → running ("Blocking… 80 of 127") → done (the caller shows the toast)
 *
 * If the connection drops part-way, it says what was done and offers to
 * continue the same action — the server never applies a student twice.
 */
/** Who the action applies to, and who it skips — the same rules as the server. */
export function planBulk(action, rows) {
  const eligible = [];
  const skipped = {};
  const skip = (key) => { skipped[key] = (skipped[key] ?? 0) + 1; };
  for (const row of rows) {
    if (action === 'block') {
      if (effectiveApprovalStatus(row) === 'pending') skip('awaitingApproval');
      else if (row.blocked === true) skip('alreadyBlocked');
      else eligible.push(row);
    } else if (action === 'unblock') {
      if (row.blocked === true) eligible.push(row);
      else skip('notBlocked');
    } else if (action === 'approveReceipts') {
      if (row.pendingReceipt) eligible.push(row);
      else skip('noReceipt');
    } else if (action === 'cancelSchedule') {
      if (row.scheduledBlock?.batchId) eligible.push(row);
      else skip('notScheduled');
    }
  }
  const perClass = new Map();
  for (const row of eligible) perClass.set(row.class || 'No class', (perClass.get(row.class || 'No class') ?? 0) + 1);
  return {
    eligible,
    skipped,
    perClass: [...perClass.entries()].sort((a, b) => b[1] - a[1]),
    owing: eligible.filter((r) => (r.feeBalance ?? 0) > 0).length,
  };
}

export default function BulkActionModal({ action, rows, sessionOf, onClose, onDone, schedule = null }) {
  const text = BULK_TEXT[action] ?? BULK_TEXT.block;
  const feesFlag = useFlag('fees.enabled');
  const { tierRank, isSuperadmin } = useAuthState();
  const feesUsable = feesFlag && (isSuperadmin || (tierRank ?? 0) >= TIER_RANK.silver);

  const [step, setStep] = useState(action === 'block' ? 'form' : 'confirm');
  const [kind, setKind] = useState(feesUsable ? 'fees' : 'other');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [partial, setPartial] = useState(null);

  const timing = useBlockWhen(schedule);
  const [showWhenProblem, setShowWhenProblem] = useState(false);
  // A scheduled block takes every selected student: the skip rules apply at
  // the time it starts, not now (someone may be approved meanwhile).
  const scheduling = action === 'block' && timing.scheduled;
  const plan = useMemo(() => {
    const p = planBulk(action, rows);
    return scheduling ? { ...p, eligible: rows, skipped: {}, perClass: planBulk('unblock', rows.map((r) => ({ ...r, blocked: true }))).perClass } : p;
  }, [action, rows, scheduling]);
  const isFees = action === 'block' && kind === 'fees' && feesUsable;
  const n = plan.eligible.length;

  const toConfirm = () => {
    if (scheduling && timing.problem) {
      setShowWhenProblem(true);
      return;
    }
    if (isFees) {
      const value = Number(amount);
      if (!Number.isInteger(value) || value < 1) {
        setError('Enter the amount owed, in whole shillings.');
        return;
      }
    }
    setError(null);
    setStep('confirm');
  };

  const start = async (resume = null) => {
    setError(null);
    setStep('running');
    try {
      const items = plan.eligible.map((row) => ({ session: sessionOf(row), phone: row.id }));
      if (scheduling) {
        const res = await runSchedule({
          items,
          atMs: timing.atMs,
          kind: isFees ? 'fees' : 'other',
          amount: isFees ? Number(amount) : undefined,
          reason: isFees ? undefined : reason.trim(),
          onProgress: (done, total) => setProgress({ done, total }),
        });
        onDone({ ...res, done: res.added, action, scheduled: true, failed: [] });
        return;
      }
      if (action === 'cancelSchedule') {
        const res = await removeFromSchedule(items, (done, total) => setProgress({ done, total }));
        onDone({ ...res, action });
        return;
      }
      const result = await runBulk({
        action,
        items: plan.eligible.map((row) => ({ session: sessionOf(row), phone: row.id })),
        kind: action === 'block' ? (isFees ? 'fees' : 'other') : undefined,
        amount: isFees ? Number(amount) : undefined,
        reason: action === 'block' && !isFees ? reason.trim() : undefined,
        onProgress: (done, total) => setProgress({ done, total }),
        resume,
      });
      onDone({ ...result, action, kind: action === 'block' ? (isFees ? 'fees' : 'other') : null, amount: isFees ? Number(amount) : null, reason });
    } catch (err) {
      if (err instanceof BulkInterrupted) {
        setPartial(err.partial);
        setStep('interrupted');
      } else {
        setError(err?.message ?? 'Nothing was changed. Please try again.');
        setStep('confirm');
      }
    }
  };

  const title = `${text.verb} ${plural(rows.length, 'student')}`;
  const skippedLines = describeSkipped(plan.skipped);

  if (step === 'form') {
    return (
      <Modal title={title} onClose={onClose} onConfirm={toConfirm} type="danger" confirmLabel="Continue">
        <p className="mb-3">
          Block <strong>{plural(rows.length, 'selected student')}</strong> from class?
        </p>
        <BlockForm
          idPrefix="bulk-block"
          kind={feesUsable ? kind : 'other'}
          onKind={setKind}
          amount={amount}
          onAmount={setAmount}
          reason={reason}
          onReason={setReason}
          error={error}
          feesUsable={feesUsable}
          feesFlag={feesFlag}
          count={rows.length}
          timing={{ ...timing, showProblem: showWhenProblem }}
        />
      </Modal>
    );
  }

  if (step === 'running' || step === 'interrupted') {
    const footer = step === 'interrupted' ? (
      <>
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={() => start(partial)}>Continue</button>
      </>
    ) : null;
    return (
      <Modal title={title} onClose={step === 'running' ? () => {} : onClose} footer={footer}>
        {step === 'running' ? (
          <div className="text-center py-3" role="status" aria-live="polite" data-testid="bulk-progress">
            <span className="spinner-border spinner-border-sm text-primary me-2" aria-hidden="true" />
            {scheduling ? 'Scheduling' : text.ing}… {progress.done} of {progress.total}
          </div>
        ) : (
          <div className="alert alert-warning mb-0" role="alert" data-testid="bulk-interrupted">
            The connection dropped after {partial?.next ?? 0} of {partial?.total ?? n}. Those are done.
            Continue to finish the remaining {(partial?.total ?? n) - (partial?.next ?? 0)}.
          </div>
        )}
      </Modal>
    );
  }

  // Confirm.
  const when = scheduling ? ` from ${formatWhen(timing.atMs)}` : '';
  const confirmLabel = n > 0 ? (scheduling ? `Schedule ${plural(n, 'block')}` : `${text.verb} ${plural(n, 'student')}`) : 'Nothing to do';
  return (
    <Modal
      title={`${text.verb} ${plural(n, 'student')}${when}?`}
      onClose={onClose}
      onConfirm={n > 0 ? () => start() : onClose}
      type={action === 'block' ? 'danger' : 'primary'}
      confirmLabel={confirmLabel}
      cancelLabel="Back"
    >
      <div data-testid="bulk-confirm">
        {plan.perClass.length > 0 && (
          <p className="mb-2 small">
            {plan.perClass.map(([cls, count]) => `${cls}: ${count}`).join(' · ')}
          </p>
        )}
        {skippedLines.length > 0 && (
          <p className="mb-2 small text-muted" data-testid="bulk-skipped">
            <strong>{plural(rows.length - n, 'will be skipped', 'will be skipped')}:</strong> {skippedLines.join(', ')}.
          </p>
        )}
        {scheduling && (
          <p className="mb-2 small" data-testid="bulk-scheduled-note">
            Starts {formatWhen(timing.atMs)} (Nairobi time).{isFees ? ' The amount is recorded then.' : ''} Anyone waiting for approval
            or already blocked at that time is skipped, and anyone who pays before then is taken out. You can change or
            cancel it under <strong>Scheduled</strong>.
          </p>
        )}
        {action === 'block' && n > 0 && (
          <p className="mb-2 small">
            {isFees
              ? `Each will owe ${formatKes(Number(amount))} and see it on their screen.`
              : reason.trim() ? `They will see: “${reason.trim()}”` : 'They will be told to contact you.'}
          </p>
        )}
        {action === 'approveReceipts' && n > 0 && (
          <p className="mb-2 small">
            {plan.owing > 0 && `${plural(plan.owing, 'owes', 'owe')} a balance: each balance is recorded as paid, with the M-Pesa code from their receipt, and they are let back in. `}
            {n - plan.owing > 0 && `${plural(n - plan.owing, 'owes nothing', 'owe nothing')}: they are let back in.`}
          </p>
        )}
        {!scheduling && action !== 'cancelSchedule' && (
          <p className="mb-0 small text-muted">You can undo this for 30 minutes from <strong>Recent actions</strong>.</p>
        )}
        {error && <div className="alert alert-danger mt-3 mb-0 small">{error}</div>}
      </div>
    </Modal>
  );
}
