import { useState } from 'react';
import { declineDuplicate, mergeDuplicates, keepBothDuplicates } from '@services/api/students';
import { mpesaCode, retiredMessage } from '@utils/duplicates';
import { formatKes } from '@utils/blockReason';
import { suffixOf, reasonLabels } from '../../duplicates/duplicatePairs';

/**
 * One possible-duplicate pair, side by side (stacked on a phone) — 003Fixes / 13.
 * Merge (keep one, the other's notes and fees move to it), Decline one, or
 * Keep both; each confirmed first, saying exactly what happens and what the
 * removed number will be told. The live listeners then update the rosters,
 * so the pair disappears without a fetch.
 */

const millis = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : null);
const phoneOf = (s) => s?.parentPhone ?? s?.id ?? '';
const when = (v) => {
  const ms = millis(v);
  return ms ? new Date(ms).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};
const approval = (s) => (s.approvalStatus ? s.approvalStatus[0].toUpperCase() + s.approvalStatus.slice(1) : 'Approved');

/** The record a merge keeps by default: the one checked in most recently. */
export function defaultKeep(a, b) {
  const la = millis(a.lastAccessed) ?? 0;
  const lb = millis(b.lastAccessed) ?? 0;
  if (la !== lb) return la > lb ? a : b;
  return (millis(a.registeredAt) ?? 0) <= (millis(b.registeredAt) ?? 0) ? a : b;
}

function Side({ student, code }) {
  const receipt = String(student.receiptMessage ?? '');
  const parts = code && receipt.includes(code) ? receipt.split(code) : null;
  return (
    <div className="duplicate-side">
      <div className="d-flex justify-content-between gap-2">
        <span className="fw-bold">{student.studentName}</span>
        <span className="badge text-bg-secondary align-self-start">{suffixOf(phoneOf(student))}</span>
      </div>
      <div className="small text-muted">{student.class} · {phoneOf(student)}</div>
      <dl className="duplicate-facts small mb-0">
        <dt>Subjects</dt><dd>{student.subjects || '—'}</dd>
        <dt>Receipt</dt>
        <dd className="text-break">
          {parts ? <>{parts[0]}<mark>{code}</mark>{parts.slice(1).join(code)}</> : (receipt || '—')}
        </dd>
        <dt>Registered</dt><dd>{when(student.registeredAt)}</dd>
        <dt>Last check-in</dt><dd>{when(student.lastAccessed)}</dd>
        <dt>Status</dt>
        <dd>
          {approval(student)}
          {student.blocked === true ? <span className="badge text-bg-danger ms-1">Blocked</span> : null}
          {student.duplicateHold ? <span className="badge text-bg-warning ms-1">Held</span> : null}
        </dd>
        <dt>Fee balance</dt><dd>{formatKes(Number(student.feeBalance) || 0)}</dd>
      </dl>
    </div>
  );
}

export default function DuplicatePair({ session, pair, sessionName, showSuccess, showError }) {
  const { a, b, reasons } = pair;
  const [mode, setMode] = useState(null); // 'merge' | 'decline' | 'keep'
  const [keepPhone, setKeepPhone] = useState(() => phoneOf(defaultKeep(a, b)));
  const [declinePhone, setDeclinePhone] = useState(() => phoneOf(a.duplicateHold ? a : b.duplicateHold ? b : defaultKeep(a, b) === a ? b : a));
  const [busy, setBusy] = useState(false);

  const codeA = mpesaCode(a.receiptMessage);
  const sharedCode = codeA && codeA === mpesaCode(b.receiptMessage) ? codeA : null;
  const keep = phoneOf(a) === keepPhone ? a : b;
  const remove = keep === a ? b : a;
  const blockedDiffers = (a.blocked === true) !== (b.blocked === true);

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      showSuccess?.(message, 'Possible duplicates');
      setMode(null);
    } catch (err) {
      showError?.(err?.message ?? 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const choice = (name, phone, selected, onSelect, label) => (
    <label className="form-check-label d-flex align-items-center gap-2" key={phone}>
      <input type="radio" className="form-check-input m-0" name={name} checked={selected} onChange={onSelect} />
      {label}
    </label>
  );
  const radioName = `${session}-${pair.key}`;

  return (
    <div className="duplicate-pair card mb-3" data-testid="duplicate-pair">
      <div className="card-body">
        <div className="d-flex flex-wrap gap-1 mb-2">
          {sessionName ? <span className="badge text-bg-light text-muted">{sessionName}</span> : null}
          {reasonLabels(reasons).map((label) => <span key={label} className="badge text-bg-warning">{label}</span>)}
        </div>
        <div className="duplicate-sides">
          <Side student={a} code={sharedCode} />
          <Side student={b} code={sharedCode} />
        </div>

        {mode === null && (
          <div className="d-flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setMode('merge')} disabled={busy}>Merge</button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setMode('decline')} disabled={busy}>Decline one</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode('keep')} disabled={busy}>Keep both</button>
          </div>
        )}

        {mode === 'merge' && (
          <div className="duplicate-confirm mt-3" role="group" aria-label="Merge">
            <div className="d-flex flex-wrap gap-3 mb-2">
              {[a, b].map((s) => choice(`${radioName}-keep`, phoneOf(s), keepPhone === phoneOf(s), () => setKeepPhone(phoneOf(s)), `Keep ${suffixOf(phoneOf(s))}`))}
            </div>
            <p className="small mb-2">
              Keep {suffixOf(phoneOf(keep))}, remove {suffixOf(phoneOf(remove))}. Notes and fee history move to {suffixOf(phoneOf(keep))}.
              {' '}{suffixOf(phoneOf(remove))} will be told to use {suffixOf(phoneOf(keep))}.
            </p>
            {blockedDiffers && (
              <p className="small text-danger mb-2">
                {suffixOf(phoneOf(a.blocked === true ? a : b))} is blocked and {suffixOf(phoneOf(a.blocked === true ? b : a))} is not.
                {' '}The kept record's state stands.
              </p>
            )}
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                onClick={() => run(() => mergeDuplicates(session, phoneOf(keep), phoneOf(remove)), `Merged into ${suffixOf(phoneOf(keep))}.`)}>
                Yes, merge
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode(null)} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {mode === 'decline' && (
          <div className="duplicate-confirm mt-3" role="group" aria-label="Decline one">
            <div className="d-flex flex-wrap gap-3 mb-2">
              {[a, b].map((s) => choice(`${radioName}-decline`, phoneOf(s), declinePhone === phoneOf(s), () => setDeclinePhone(phoneOf(s)), `Decline ${suffixOf(phoneOf(s))}`))}
            </div>
            <p className="small mb-2">
              {suffixOf(declinePhone)} is removed (its notes too; its fee record is kept and closed). It will be told:
              <span className="d-block fst-italic mt-1">“{retiredMessage('duplicate')}”</span>
            </p>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                onClick={() => run(() => declineDuplicate(session, declinePhone), `${suffixOf(declinePhone)} declined.`)}>
                {`Yes, decline ${suffixOf(declinePhone)}`}
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode(null)} disabled={busy}>Back</button>
            </div>
          </div>
        )}

        {mode === 'keep' && (
          <div className="duplicate-confirm mt-3" role="group" aria-label="Keep both">
            <p className="small mb-2">Keep both registrations? They will not be flagged as duplicates again.</p>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                onClick={() => run(() => keepBothDuplicates(session, phoneOf(a), phoneOf(b)), 'Both kept.')}>
                Yes, keep both
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setMode(null)} disabled={busy}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
