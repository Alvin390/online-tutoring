import { useState } from 'react';
import Modal from '@components/ui/Modal';
import { formatKes } from '@utils/blockReason';

/**
 * "Mark … as staff?" — 007Fixes / 09 (owner, 2026-11-11).
 *
 * Says exactly what marking does before it is done: staff are not counted as
 * students, cannot be blocked and still get the class link; any balance is
 * closed as "Staff, no fee"; and the same number's record in another session
 * can be marked too (ticked by default). A lazy chunk: it costs nothing until
 * the teacher marks someone.
 *
 * @param {Array<{session, sessionName?, phone, name, balance}>} people
 * @param {Array<{session, sessionName, phone, balance}>} others  the same numbers elsewhere
 */
export default function MarkStaffDialog({ people, others = [], onConfirm, onCancel, busy = false }) {
  const [alsoOther, setAlsoOther] = useState(true);
  const one = people.length === 1;
  const owed = people.reduce((sum, p) => sum + Math.max(0, Number(p.balance) || 0), 0);
  const title = one ? `Mark ${people[0].name || 'this person'} as staff?` : `Mark ${people.length} people as staff?`;

  let alsoLabel = null;
  if (others.length) {
    if (one && others.length === 1) {
      const o = others[0];
      alsoLabel = <>Also mark their {o.sessionName} record{o.balance > 0 ? ` (owes ${formatKes(o.balance)}, also closed)` : ''}</>;
    } else {
      const otherOwed = others.reduce((sum, o) => sum + o.balance, 0);
      alsoLabel = <>Also mark their records in other sessions ({others.length} found){otherOwed > 0 ? `, ${formatKes(otherOwed)} owed there, also closed` : ''}</>;
    }
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      onConfirm={() => onConfirm({ alsoOtherSession: others.length > 0 && alsoOther })}
      loading={busy}
      confirmLabel="Mark as staff"
      type="primary"
    >
      <p className="mb-2">Staff aren&apos;t counted as students, can&apos;t be blocked, and still get the class link.</p>
      {owed > 0 && (
        <p className="mb-2 fw-semibold" data-testid="mark-staff-balance">
          {one
            ? <>Their balance of {formatKes(owed)} will be closed as &quot;Staff, no fee&quot;.</>
            : <>{formatKes(owed)} owed in total will be closed as &quot;Staff, no fee&quot;.</>}
        </p>
      )}
      {alsoLabel && (
        <div className="form-check mt-3">
          <input
            id="mark-staff-also"
            type="checkbox"
            className="form-check-input"
            checked={alsoOther}
            onChange={(e) => setAlsoOther(e.target.checked)}
            disabled={busy}
          />
          <label className="form-check-label" htmlFor="mark-staff-also">{alsoLabel}</label>
        </div>
      )}
      <p className="small text-muted mt-3 mb-0">
        You can set them back to student from the Staff tab.
      </p>
    </Modal>
  );
}
