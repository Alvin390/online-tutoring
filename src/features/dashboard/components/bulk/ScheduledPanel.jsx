import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@components/ui/Modal';
import { listSchedules, rescheduleSchedule, cancelSchedule, removeFromSchedule } from '@services/api/students';
import { formatKes } from '@utils/blockReason';
import { formatWhen, toInputs, fromInputs, whenProblem } from '../../bulk/scheduleTime';

/**
 * Scheduled — 003Fixes / 08. Every waiting scheduled block: whole batches and
 * single students, each can be rescheduled or cancelled, and a batch can be
 * opened to take one student out. Names come from the rosters the dashboard
 * already holds (each student's `scheduledBlock.batchId`), not from a request.
 * A lazy chunk, opened from the student list's toolbar.
 */

function what(schedule) {
  if (schedule.kind === 'fees') return `unpaid fees ${schedule.amount ? formatKes(schedule.amount) : ''}`.trim();
  return schedule.reason ? `“${schedule.reason}”` : 'no reason given';
}

export default function ScheduledPanel({ rosters, sessionNames = {}, onClose, showSuccess, showError }) {
  const [schedules, setSchedules] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  // batchId → [{ session, student }], from the live rosters.
  const members = useMemo(() => {
    const map = new Map();
    for (const [session, list] of Object.entries(rosters ?? {})) {
      for (const student of list ?? []) {
        const id = student?.scheduledBlock?.batchId;
        if (!id) continue;
        map.set(id, [...(map.get(id) ?? []), { session, student }]);
      }
    }
    return map;
  }, [rosters]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSchedules((await listSchedules()).schedules ?? []);
    } catch (err) {
      setError(err?.message ?? 'Could not load scheduled blocks.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      showSuccess?.(success, 'Scheduled');
      setEditing(null);
      setConfirming(null);
      await load();
    } catch (err) {
      showError?.(err?.message ?? 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (s) => members.get(s.id)?.[0]?.student?.studentName ?? '1 student';

  return (
    <Modal title="Scheduled blocks" onClose={busy ? () => {} : onClose} wide footer={(
      <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Close</button>
    )}>
      <p className="small text-muted">Blocks waiting to start. Anyone who pays first is taken out automatically.</p>
      {error && (
        <div className="alert alert-warning small">
          {error}{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={load}>Try again</button>
        </div>
      )}
      {schedules === null && !error && <p className="text-center text-muted small py-3">Loading…</p>}
      {schedules?.length === 0 && <p className="text-center text-muted small py-3" data-testid="scheduled-empty">Nothing scheduled.</p>}
      <ul className="list-group" data-testid="scheduled-list">
        {(schedules ?? []).map((s) => {
          const single = s.count === 1;
          const people = members.get(s.id) ?? [];
          return (
            <li key={s.id} className="list-group-item" data-testid="scheduled-item">
              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold small">
                    {single ? nameOf(s) : `${s.count} students`} · {what(s)}
                  </div>
                  <div className="text-muted small">Blocked from {formatWhen(s.atMs)}</div>
                </div>
                <div className="d-flex gap-1 flex-wrap">
                  {!single && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                      {open === s.id ? 'Hide students' : 'Show students'}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-outline-primary" disabled={busy}
                    onClick={() => setEditing({ id: s.id, ...toInputs(s.atMs), problem: null })}>
                    Reschedule
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => setConfirming(s.id)}>
                    Cancel
                  </button>
                </div>
              </div>

              {editing?.id === s.id && (
                <div className="mt-2 d-flex gap-2 flex-wrap align-items-end" role="group" aria-label="New time">
                  <label className="small">
                    Date
                    <input type="date" className="form-control form-control-sm" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value, problem: null })} />
                  </label>
                  <label className="small">
                    Time
                    <input type="time" className="form-control form-control-sm" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value, problem: null })} />
                  </label>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => {
                    const atMs = fromInputs(editing.date, editing.time);
                    const problem = whenProblem(atMs);
                    if (problem) { setEditing({ ...editing, problem }); return; }
                    run(() => rescheduleSchedule(s.id, atMs), `Moved to ${formatWhen(atMs)}.`);
                  }}>Save</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)}>Keep</button>
                  {editing.problem && <div className="text-danger small w-100">{editing.problem}</div>}
                </div>
              )}

              {confirming === s.id && (
                <div className="mt-2 small" role="group" aria-label="Confirm cancel">
                  Cancel this scheduled block{single ? '' : ` for ${s.count} students`}?{' '}
                  <button type="button" className="btn btn-sm btn-danger ms-1" disabled={busy}
                    onClick={() => run(() => cancelSchedule(s.id), 'Scheduled block cancelled.')}>Yes, cancel it</button>{' '}
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setConfirming(null)}>Keep it</button>
                </div>
              )}

              {open === s.id && (
                <ul className="list-unstyled mt-2 mb-0 small scheduled-members" data-testid="scheduled-members">
                  {people.map(({ session, student }) => (
                    <li key={`${session}:${student.id}`} className="d-flex justify-content-between align-items-center py-1 border-top">
                      <span>
                        {student.studentName}
                        {Object.keys(rosters ?? {}).length > 1 && <span className="text-muted"> · {sessionNames[session] ?? session}</span>}
                      </span>
                      <button type="button" className="btn btn-sm btn-link text-danger p-0" disabled={busy}
                        aria-label={`Remove ${student.studentName} from this schedule`}
                        onClick={() => run(() => removeFromSchedule([{ session, phone: student.id }]), `${student.studentName} will not be blocked.`)}>
                        Remove
                      </button>
                    </li>
                  ))}
                  {people.length < s.count && (
                    <li className="text-muted py-1 border-top">and {s.count - people.length} in sessions not loaded here</li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
