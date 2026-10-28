import { useState } from 'react';
import { useStudentFees } from '../hooks/useStudentFees';
import { formatKes } from '@utils/blockReason';
import { SkeletonLine, SkeletonStyles } from '@components/ui/Skeleton';

/**
 * A student's fee statement and payment entry — Phase 06 D3.
 *
 * The statement shows reversals alongside the entries they reverse, rather than
 * hiding corrected mistakes. That is the point of an append-only ledger: a
 * parent disputing a charge can be shown every event in order, including who
 * corrected what and when.
 */

const METHODS = [
  { id: 'cash', label: 'Cash', icon: 'bi-cash' },
  { id: 'mpesa', label: 'M-Pesa', icon: 'bi-phone' },
  { id: 'bank', label: 'Bank', icon: 'bi-bank' },
];

const TYPE_META = {
  invoice: { label: 'Invoice', icon: 'bi-file-earmark-text', tone: 'text-dark' },
  payment: { label: 'Payment', icon: 'bi-check-circle', tone: 'text-success' },
  adjustment: { label: 'Adjustment', icon: 'bi-sliders', tone: 'text-warning' },
  reversal: { label: 'Reversal', icon: 'bi-arrow-counterclockwise', tone: 'text-danger' },
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The M-Pesa receipt code as a chip with a copy button — Phase 13 / 04 D2.
 * Monospace so 0/O and 1/I are distinguishable when read out to a parent.
 */
function ReceiptChip({ reference }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="d-inline-flex align-items-center gap-1">
      <code className="bg-light border rounded px-2 py-0 text-dark" style={{ fontSize: '0.85rem' }}>{reference}</code>
      <button
        type="button"
        className="btn btn-link btn-sm p-0"
        onClick={() => {
          navigator.clipboard?.writeText(reference);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label={`Copy receipt ${reference}`}
      >
        <i className={`bi ${copied ? 'bi-clipboard-check' : 'bi-clipboard'}`} aria-hidden="true" />
      </button>
    </span>
  );
}

/** Inline form for a reconciled payment whose receipt never arrived. */
function AddReceipt({ entryId, onAdd, saving }) {
  const [value, setValue] = useState('');
  const [notMpesa, setNotMpesa] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="alert alert-warning py-2 px-2 small mb-0 mt-1" data-testid={`receipt-pending-${entryId}`}>
      <div className="mb-1">
        <i className="bi bi-hourglass-split me-1" aria-hidden="true" />
        Receipt not received from M-Pesa — add it from your M-Pesa statement.
      </div>
      <div className="d-flex gap-1">
        <input
          className="form-control form-control-sm"
          value={value}
          onChange={(e) => setValue(notMpesa ? e.target.value : e.target.value.toUpperCase())}
          placeholder={notMpesa ? 'e.g. Cash at school' : 'e.g. TJK9XYZ8QP'}
          maxLength={40}
          aria-label="Receipt code"
        />
        <button
          type="button"
          className="btn btn-sm btn-warning"
          disabled={saving || !value.trim()}
          onClick={async () => {
            setError('');
            const result = await onAdd(entryId, value.trim(), notMpesa);
            if (!result.success) setError(result.message ?? 'Could not add it.');
          }}
        >
          Add
        </button>
      </div>
      <div className="form-check mt-1">
        <input
          className="form-check-input"
          type="checkbox"
          id={`not-mpesa-${entryId}`}
          checked={notMpesa}
          onChange={(e) => setNotMpesa(e.target.checked)}
        />
        <label className="form-check-label" htmlFor={`not-mpesa-${entryId}`}>Not an M-Pesa receipt</label>
      </div>
      {error && <div className="text-danger mt-1" role="alert">{error}</div>}
    </div>
  );
}

export default function FeesTab({ session, phone, active }) {
  const {
    summary, entries, hasMore, loadOlder, feesEnabled, summaryFailed, loading, saving, announcement,
    pay, reverse, addReference, reload,
  } = useStudentFees({
    session,
    phone,
    enabled: active,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'mpesa', reference: '', note: '' });
  const [reversing, setReversing] = useState(null);
  const [reverseNote, setReverseNote] = useState('');
  const [error, setError] = useState('');

  // 003Fixes / 01: until the summary answers we do not know whether fees are
  // on, so hold the tab's place rather than guess (it used to guess "off").
  if (feesEnabled === null) {
    if (summaryFailed) {
      return (
        <div className="text-center py-4">
          <p className="text-muted small mb-2">Could not load this student&apos;s fees.</p>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={reload}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="py-4 d-flex flex-column gap-2" data-testid="fees-loading" role="status" aria-busy="true">
        <SkeletonStyles />
        <SkeletonLine width="40%" height={18} />
        <SkeletonLine width="70%" />
        <SkeletonLine width="55%" />
        <span className="visually-hidden">Loading fees…</span>
      </div>
    );
  }

  if (!feesEnabled) {
    return (
      <p className="text-muted small text-center py-4 mb-0">
        Fee tracking is turned off. Enable it in settings to record payments and
        balances for this student.
      </p>
    );
  }

  const balance = summary?.balance ?? 0;
  const owes = balance > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const amount = Number(form.amount);
    if (!Number.isInteger(amount) || amount < 1) {
      setError('Enter a whole number of shillings, e.g. 1500.');
      return;
    }

    const result = await pay({
      amount,
      method: form.method,
      reference: form.reference.trim() || undefined,
      note: form.note.trim() || undefined,
    });

    if (result.success) {
      setForm({ amount: '', method: 'mpesa', reference: '', note: '' });
      setShowForm(false);
    }
  };

  return (
    <div>
      {/* Screen readers hear a payment arrive while the statement is open. */}
      <div className="visually-hidden" aria-live="polite" role="status">{announcement}</div>

      {/* Balance. Icon and label alongside colour — never colour alone. */}
      <div className={`border rounded p-3 mb-3 ${owes ? 'border-danger' : 'border-success'}`}>
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <span className="text-muted small d-block">Current balance</span>
            <span className={`fs-4 fw-bold ${owes ? 'text-danger' : 'text-success'}`}>
              <i
                className={`bi ${owes ? 'bi-exclamation-circle-fill' : 'bi-check-circle-fill'} me-2`}
                aria-hidden="true"
              />
              {formatKes(Math.abs(balance))}
            </span>
            <span className="d-block small text-muted">
              {balance > 0 ? 'outstanding' : balance < 0 ? 'in credit' : 'fully paid'}
            </span>
          </div>

          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Record payment
          </button>
        </div>

        {summary?.lastPaymentAt && (
          <div className="small text-muted mt-2">
            Last payment {formatKes(summary.lastPaymentAmount ?? 0)} on{' '}
            {formatDate(summary.lastPaymentAt)}
          </div>
        )}
        {summary?.nextDueDate && owes && (
          <div className="small text-muted">Due {formatDate(summary.nextDueDate)}</div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="border rounded p-3 mb-3 bg-light">
          <div className="mb-2">
            <label className="form-label small fw-semibold" htmlFor="fee-amount">
              Amount (KES)
            </label>
            <input
              id="fee-amount"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              className="form-control"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={owes ? String(balance) : '1500'}
              required
            />
            {owes && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 mt-1"
                onClick={() => setForm({ ...form, amount: String(balance) })}
              >
                Pay full balance ({formatKes(balance)})
              </button>
            )}
          </div>

          <div className="mb-2">
            <span className="form-label small fw-semibold d-block">How was it paid?</span>
            <div className="btn-group btn-group-sm w-100" role="group">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`btn ${form.method === m.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => setForm({ ...form, method: m.id })}
                  aria-pressed={form.method === m.id}
                >
                  <i className={`bi ${m.icon} me-1`} aria-hidden="true" />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2">
            <label className="form-label small fw-semibold" htmlFor="fee-ref">
              Reference <span className="text-muted fw-normal">(optional)</span>
            </label>
            <input
              id="fee-ref"
              className="form-control form-control-sm"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="M-Pesa code or bank slip number"
              maxLength={120}
            />
          </div>

          {error && (
            <div className="alert alert-danger py-2 px-3 small" role="alert">
              {error}
            </div>
          )}

          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? <span className="spinner-border spinner-border-sm" /> : 'Record payment'}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setShowForm(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="text-center py-3">
          <span className="spinner-border spinner-border-sm text-muted" />
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="text-center py-4 border rounded bg-light">
          <i className="bi bi-receipt d-block mb-2 text-muted" style={{ fontSize: '1.75rem' }} aria-hidden="true" />
          <p className="fw-semibold mb-1">No fee history yet</p>
          <p className="small text-muted mb-0">
            Payments you record and invoices you generate will appear here.
          </p>
        </div>
      )}

      {entries.length > 0 && <h3 className="h6 fw-bold mb-2">Statement</h3>}

      {entries.map((entry) => {
        const meta = TYPE_META[entry.type] ?? TYPE_META.adjustment;
        const isReversed = Boolean(entry.reversedByEntryId);

        return (
          <div key={entry.id} className={`border rounded p-2 mb-2 ${isReversed ? 'opacity-50' : ''}`}>
            <div className="d-flex justify-content-between align-items-start gap-2">
              <div>
                <span className={`small fw-semibold ${meta.tone}`}>
                  <i className={`bi ${meta.icon} me-1`} aria-hidden="true" />
                  {meta.label}
                  {isReversed && <span className="badge text-bg-light text-muted ms-2">Reversed</span>}
                </span>
                <div className="small text-muted d-flex flex-wrap align-items-center gap-1">
                  <span>{formatDate(entry.occurredAt)}</span>
                  {entry.method && <span>· {entry.method === 'mpesa' ? 'M-Pesa' : entry.method}</span>}
                  {entry.reference && (
                    <>
                      <span>·</span>
                      {entry.method === 'mpesa' && !entry.referenceIsNotMpesa
                        ? <ReceiptChip reference={entry.reference} />
                        : <span>{entry.reference}</span>}
                    </>
                  )}
                </div>
                {entry.note && <div className="small">{entry.note}</div>}
                {entry.receiptPending && !entry.reference && (
                  <AddReceipt entryId={entry.id} onAdd={addReference} saving={saving} />
                )}
              </div>

              <div className="text-end">
                <div className={`fw-bold ${entry.amount < 0 ? 'text-success' : ''}`}>
                  {entry.amount < 0 ? '−' : '+'}
                  {formatKes(Math.abs(entry.amount))}
                </div>
                <div className="small text-muted">bal {formatKes(entry.balanceAfter)}</div>
              </div>
            </div>

            {!isReversed && entry.type !== 'reversal' && (
              <div className="mt-1">
                {reversing === entry.id ? (
                  <div>
                    <input
                      className="form-control form-control-sm mb-1"
                      placeholder="Why is this being reversed?"
                      value={reverseNote}
                      onChange={(e) => setReverseNote(e.target.value)}
                      aria-label="Reason for reversal"
                    />
                    <div className="d-flex gap-1">
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={saving || reverseNote.trim().length < 3}
                        onClick={async () => {
                          const result = await reverse(entry.id, reverseNote.trim());
                          if (result.success) {
                            setReversing(null);
                            setReverseNote('');
                          }
                        }}
                      >
                        Reverse
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setReversing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-link btn-sm p-0 text-danger"
                    onClick={() => {
                      setReversing(entry.id);
                      setReverseNote('');
                    }}
                  >
                    Reverse this entry
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {hasMore && (
        <div className="text-center">
          <button type="button" className="btn btn-link btn-sm" onClick={loadOlder}>
            Show older entries
          </button>
        </div>
      )}
    </div>
  );
}
