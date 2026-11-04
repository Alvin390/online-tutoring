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
import { receiptKes } from '../../bulk/receiptAmount';

const PARTIAL_PAGE = 50;
const owedOf = (row) => Number(row.feeBalance) || 0;
/** A partial amount for this row: whole KES, 1 .. owed - 1 (else null). */
function partialAmount(text, owed) {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n < owed ? n : null;
}

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
export function planBulk(action, rows, { noCharge = false } = {}) {
  const eligible = [];
  const skipped = {};
  const skip = (key) => { skipped[key] = (skipped[key] ?? 0) + 1; };
  for (const row of rows) {
    if (action === 'block') {
      if (effectiveApprovalStatus(row) === 'pending') skip('awaitingApproval');
      else if (row.blocked === true) skip('alreadyBlocked');
      // 006Fixes / 09: "for what they owe" skips anyone owing nothing (as the server).
      else if (noCharge && !((Number(row.feeBalance) || 0) > 0)) skip('nothingOwed');
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
  // 006Fixes / 09 (owner): when someone selected already owes, offer "Block
  // for what they owe" (no new charge) or "Add a new charge". 09b: it is the
  // DEFAULT only when everyone who would be blocked owes (e.g. selected from
  // the Partial payment filter); a mixed selection — the monthly fee block
  // over the whole roster — keeps today's default, a new charge.
  const owing = useMemo(() => {
    if (action !== 'block') return null;
    const blockable = rows.filter((r) => r.blocked !== true && effectiveApprovalStatus(r) !== 'pending');
    const owes = blockable.filter((r) => owedOf(r) > 0);
    return { count: owes.length, total: owes.reduce((s, r) => s + owedOf(r), 0), nothing: blockable.length - owes.length };
  }, [action, rows]);
  const [charge, setCharge] = useState(() => !(owing?.count > 0 && owing.nothing === 0));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [partial, setPartial] = useState(null);
  // 006Fixes / 07 (owner): approving receipts — complete for all, or partial
  // with an amount per student (prefilled from each receipt).
  const [payment, setPayment] = useState('full');
  const [amounts, setAmounts] = useState({});
  const [sameForAll, setSameForAll] = useState('');
  const [shown, setShown] = useState(PARTIAL_PAGE);

  const timing = useBlockWhen(schedule);
  const [showWhenProblem, setShowWhenProblem] = useState(false);
  // A scheduled block takes every selected student: the skip rules apply at
  // the time it starts, not now (someone may be approved meanwhile).
  const scheduling = action === 'block' && timing.scheduled;
  const noCharge = action === 'block' && kind === 'fees' && feesUsable && owing?.count > 0 && !charge;
  const plan = useMemo(() => {
    const p = planBulk(action, rows, { noCharge });
    return scheduling ? { ...p, eligible: rows, skipped: {}, perClass: planBulk('unblock', rows.map((r) => ({ ...r, blocked: true }))).perClass } : p;
  }, [action, rows, scheduling, noCharge]);
  // A fee block that charges (isFees) vs one "for what they owe" (noCharge).
  const isFees = action === 'block' && kind === 'fees' && feesUsable && !noCharge;
  const feeKind = action === 'block' && kind === 'fees' && feesUsable;
  // 006Fixes / 07: the partial step's lines and sums.
  const approving = action === 'approveReceipts' && feesUsable;
  const owingRows = useMemo(() => (approving ? plan.eligible.filter((r) => owedOf(r) > 0) : []), [approving, plan]);
  const owingTotal = owingRows.reduce((sum, r) => sum + owedOf(r), 0);
  const choosePartial = () => {
    setPayment('partial');
    setAmounts((current) => {
      const next = { ...current };
      for (const r of owingRows) {
        if (next[r.id] !== undefined) continue;
        const fromReceipt = receiptKes(r.pendingReceipt);
        next[r.id] = fromReceipt && fromReceipt < owedOf(r) ? String(fromReceipt) : '';
      }
      return next;
    });
  };
  const partialLines = owingRows.map((row) => ({ row, owed: owedOf(row), text: amounts[row.id] ?? '', value: partialAmount(amounts[row.id], owedOf(row)) }));
  const validLines = partialLines.filter((l) => l.value !== null);
  const isPartial = approving && payment === 'partial';
  const n = isPartial ? validLines.length : plan.eligible.length;

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
          kind: feeKind ? 'fees' : 'other',
          amount: isFees ? Number(amount) : undefined,
          ...(feeKind ? { charge: !noCharge } : {}),
          reason: feeKind ? undefined : reason.trim(),
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
        items: isPartial
          ? validLines.map((l) => ({ session: sessionOf(l.row), phone: l.row.id, amount: l.value }))
          : plan.eligible.map((row) => ({ session: sessionOf(row), phone: row.id })),
        ...(approving ? { payment: isPartial ? 'partial' : 'full' } : {}),
        kind: action === 'block' ? (feeKind ? 'fees' : 'other') : undefined,
        amount: isFees ? Number(amount) : undefined,
        ...(feeKind ? { charge: !noCharge } : {}),
        reason: action === 'block' && !feeKind ? reason.trim() : undefined,
        onProgress: (done, total) => setProgress({ done, total }),
        resume,
      });
      onDone({
        ...result, action, kind: action === 'block' ? (feeKind ? 'fees' : 'other') : null, amount: isFees ? Number(amount) : null, reason,
        payment: approving ? (isPartial ? 'partial' : 'full') : null,
        charge: feeKind ? !noCharge : null,
      });
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
          owing={owing}
          charge={charge}
          onCharge={setCharge}
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
  // 004Fixes / 05: "Now" stays the default (owner), so the confirmation says
  // plainly that it starts now — on the panel and on the button.
  const blockingNow = action === 'block' && !scheduling && n > 0;
  let confirmLabel = 'Nothing to do';
  if (n > 0 && scheduling) confirmLabel = `Schedule ${plural(n, 'block')} for ${formatWhen(timing.atMs)}`;
  else if (n > 0 && isPartial) confirmLabel = `Approve ${n} (partial)`;
  else if (n > 0) confirmLabel = `${text.verb} ${plural(n, 'student')}${blockingNow ? ' now' : ''}`;
  const tail = isFees ? (n === 1 ? `, and is charged ${formatKes(Number(amount))} now` : `, and each is charged ${formatKes(Number(amount))} now`)
    : noCharge ? ' (no new charge)' : '';
  const nowWarning = n === 1
    ? `Starts now: this student loses access to class immediately${tail}.`
    : `Starts now: these ${n} students lose access to class immediately${tail}.`;
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
        {blockingNow && (
          <div className="alert alert-danger py-2 small fw-semibold" data-testid="bulk-now-warning">{nowWarning}</div>
        )}
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
            Starts {formatWhen(timing.atMs)} (Nairobi time).{isFees ? ' The amount is recorded then.' : ''}
            {noCharge ? ' No new charge. Only students who still owe at that time are blocked.' : ''} Anyone waiting for approval
            or already blocked at that time is skipped, and anyone who pays before then is taken out. You can change or
            cancel it under <strong>Scheduled</strong>.
          </p>
        )}
        {action === 'block' && n > 0 && (
          <p className="mb-2 small">
            {isFees
              ? `Each will owe ${formatKes(Number(amount))} and see it on their screen.`
              : noCharge ? 'No new charge: each sees what they already owe on their screen.'
                : reason.trim() ? `They will see: “${reason.trim()}”` : 'They will be told to contact you.'}
          </p>
        )}
        {approving && owingRows.length > 0 && (
          <div className="d-grid gap-2 mb-2" role="radiogroup" aria-label="How much was paid">
            <label className={`border rounded p-2 small ${payment === 'full' ? 'border-success bg-success bg-opacity-10' : ''}`}>
              <input type="radio" className="form-check-input me-2" name="bulk-approve-payment" checked={payment === 'full'} onChange={() => setPayment('full')} />
              <strong>Complete payment for all</strong>
              <div className="text-muted ms-4" data-testid="bulk-approve-complete">
                Records each student&apos;s full balance as paid ({formatKes(owingTotal)} for {plural(owingRows.length, 'student')}).
              </div>
            </label>
            <label className={`border rounded p-2 small ${payment === 'partial' ? 'border-warning bg-warning bg-opacity-10' : ''}`}>
              <input type="radio" className="form-check-input me-2" name="bulk-approve-payment" checked={payment === 'partial'} onChange={choosePartial} />
              <strong>Partial payment</strong>
              <div className="text-muted ms-4">Type what each student paid. The rest stays owing.</div>
            </label>
          </div>
        )}
        {isPartial && (
          <div className="mb-2" data-testid="partial-step">
            <div className="d-flex gap-2 align-items-end mb-2 flex-wrap">
              <div>
                <label htmlFor="bulk-same-amount" className="form-label small mb-1">Same amount for all</label>
                <input id="bulk-same-amount" className="form-control form-control-sm" inputMode="numeric" style={{ maxWidth: 140 }}
                  value={sameForAll} onChange={(e) => setSameForAll(e.target.value)} />
              </div>
              <button type="button" className="btn btn-sm btn-outline-secondary"
                onClick={() => setAmounts((cur) => Object.fromEntries([...Object.entries(cur), ...owingRows.map((r) => [r.id, sameForAll.trim()])]))}
                disabled={!sameForAll.trim()}>
                Use for all
              </button>
            </div>
            <ul className="list-group partial-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {partialLines.slice(0, shown).map((l) => {
                const invalid = l.text.trim() !== '' && l.value === null;
                return (
                  <li key={`${sessionOf(l.row)}/${l.row.id}`} data-testid="partial-line"
                    className={`list-group-item py-2 small ${invalid ? 'partial-invalid' : ''}`}>
                    <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                      <div>
                        <strong>{l.row.studentName || 'No name'}</strong>
                        <span className="text-muted"> · {l.row.class || 'No class'} · owes {formatKes(l.owed)}</span>
                        {l.value !== null && <div className="text-muted">owes {formatKes(l.owed - l.value)} after</div>}
                        {invalid && <div className="text-danger">1 to {formatKes(l.owed - 1)}; for the full amount use Complete payment.</div>}
                      </div>
                      <input className={`form-control form-control-sm ${invalid ? 'is-invalid' : ''}`} style={{ maxWidth: 120 }} inputMode="numeric"
                        aria-label={`Amount paid by ${l.row.studentName || 'this student'}`}
                        value={l.text} onChange={(e) => setAmounts((cur) => ({ ...cur, [l.row.id]: e.target.value }))} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {partialLines.length > shown && (
              <button type="button" className="btn btn-link btn-sm px-0" onClick={() => setShown((s) => s + PARTIAL_PAGE)}>
                Show {Math.min(PARTIAL_PAGE, partialLines.length - shown)} more
              </button>
            )}
            {partialLines.length - validLines.length > 0 && (
              <p className="small text-warning-emphasis mt-2 mb-1" data-testid="partial-needs">
                {partialLines.length - validLines.length === 1 ? '1 needs an amount.' : `${partialLines.length - validLines.length} need an amount.`}
              </p>
            )}
            {plan.eligible.length - owingRows.length > 0 && (
              <p className="small text-muted mb-1" data-testid="partial-not-owing">
                {plan.eligible.length - owingRows.length === 1
                  ? '1 owes nothing and is not included: approve them with Complete payment.'
                  : `${plan.eligible.length - owingRows.length} owe nothing and are not included: approve them with Complete payment.`}
              </p>
            )}
            {validLines.length > 0 && (
              <p className="small fw-semibold mb-0" data-testid="partial-total">
                Records {formatKes(validLines.reduce((s, l) => s + l.value, 0))} paid across {plural(validLines.length, 'student')}.{' '}
                {formatKes(validLines.reduce((s, l) => s + (l.owed - l.value), 0))} stays owing.
              </p>
            )}
          </div>
        )}
        {action === 'approveReceipts' && n > 0 && !isPartial && (
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
