/**
 * Why a student (or a selection) is blocked: unpaid fees with an amount, or
 * another reason in words — 003Fixes / 05. Extracted unchanged from the
 * single-student block modal so the bulk block asks exactly the same thing.
 * Phase 08 adds Now / Schedule below it.
 */
export default function BlockForm({
  idPrefix = 'block',
  kind,
  onKind,
  amount,
  onAmount,
  reason,
  onReason,
  error,
  feesUsable,
  feesFlag,
  count = 1,
}) {
  const many = count > 1;
  return (
    <>
      <div className="mb-3 text-start">
        <span className="form-label fw-bold d-block" id={`${idPrefix}-kind-label`}>
          <i className="bi bi-chat-left-text me-2" />
          Why?
        </span>
        <div className="btn-group w-100 mb-3" role="radiogroup" aria-labelledby={`${idPrefix}-kind-label`}>
          <button
            type="button"
            role="radio"
            aria-checked={kind === 'fees'}
            aria-describedby={feesUsable ? undefined : `${idPrefix}-fees-unavailable`}
            className={`btn ${kind === 'fees' ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => onKind('fees')}
            disabled={!feesUsable}
          >
            <i className="bi bi-cash-coin me-1" aria-hidden="true" />
            Unpaid fees
            {!feesUsable && <i className="bi bi-lock-fill ms-1" aria-hidden="true" />}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === 'other'}
            className={`btn ${kind === 'other' ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => onKind('other')}
          >
            <i className="bi bi-pencil me-1" aria-hidden="true" />
            Another reason
          </button>
        </div>

        {!feesUsable && (
          <div id={`${idPrefix}-fees-unavailable`} className="form-text mb-2">
            {feesFlag
              ? 'Blocking for unpaid fees records the amount owed, which needs the Silver plan.'
              : 'Turn on fee tracking to block for unpaid fees and let students pay by M-Pesa.'}
          </div>
        )}

        {kind === 'fees' && feesUsable ? (
          <>
            <label className="form-label small fw-semibold" htmlFor={`${idPrefix}-amount`}>
              {many ? 'Amount each student owes (KES)' : 'Amount owed (KES)'}
            </label>
            <input
              id={`${idPrefix}-amount`}
              type="text"
              inputMode="numeric"
              className={`form-control ${error ? 'is-invalid' : ''}`}
              value={amount}
              onChange={(e) => onAmount(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="e.g. 1500"
              autoFocus
            />
            {error && <div className="invalid-feedback d-block">{error}</div>}
            <div className="form-text">
              {many ? 'Charged to each student’s fee account.' : 'Charged to their fee account.'} They can pay it by M-Pesa from their own
              screen — paying in full unblocks them automatically, and a part payment
              lowers the balance but leaves the block for you to lift.
            </div>
          </>
        ) : (
          <>
            <label className="form-label small fw-semibold" htmlFor={`${idPrefix}-reason`}>
              Reason <span className="text-muted fw-normal">(optional)</span>
            </label>
            <textarea
              id={`${idPrefix}-reason`}
              className="form-control"
              rows="3"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              placeholder={many ? 'e.g., Next week’s fee is due' : 'e.g., Repeated disruption in class'}
            />
            {error && <div className="text-danger small mt-1">{error}</div>}
          </>
        )}
      </div>

      <div className="alert alert-warning text-start">
        <i className="bi bi-exclamation-triangle me-2" />
        <small>
          {kind === 'fees' && feesUsable
            ? `${many ? 'Each student sees' : 'The student sees'} the balance owed and can clear it by M-Pesa to regain access.`
            : `${many ? 'They' : 'The student'} will be blocked until you unblock them from this dashboard.`}
        </small>
      </div>
    </>
  );
}
