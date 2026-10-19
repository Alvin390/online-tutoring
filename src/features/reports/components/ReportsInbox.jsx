import { useCallback, useEffect, useState } from 'react';
import Modal from '@components/ui/Modal';
import {
  addReportNote, getReport, listReports, resendReportEmail, setReportStatus,
} from '@services/api/reports';
import { STATUS_LABELS, STATUS_TONE, statusesFor } from '../constants';
import '../reports.css';

/**
 * One superadmin inbox — bug reports OR feature requests, never mixed
 * (Phase 13 / 06 D7). Status chips with counts ("New" first), a list with the
 * response countdown, and a detail panel with screenshots, status, internal
 * notes, the email's delivery state and "Resend".
 *
 * `initialReportId` opens a report straight away — the link in every alert
 * email is /superadmin?tab=bugs&report=<id>.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The countdown: amber in the last quarter of the window, red when overdue. */
export function dueState(createdAt, responseDueAt, now = Date.now()) {
  if (!responseDueAt) return { tone: 'ok', label: '—' };
  const due = new Date(responseDueAt).getTime();
  const start = createdAt ? new Date(createdAt).getTime() : due - DAY;
  const left = due - now;
  const abs = Math.abs(left);
  const text = abs >= DAY ? `${Math.round(abs / DAY)}d` : abs >= 3_600_000 ? `${Math.round(abs / 3_600_000)}h` : `${Math.max(1, Math.round(abs / 60_000))}m`;
  if (left < 0) return { tone: 'overdue', label: `Overdue by ${text}` };
  const window = Math.max(1, due - start);
  return { tone: left <= window * 0.25 ? 'soon' : 'ok', label: `Due in ${text}` };
}

const age = (iso) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (ms < DAY) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / DAY)}d ago`;
};

const EMAIL_LABEL = {
  sent: ['success', 'Email sent'],
  pending: ['secondary', 'Email queued'],
  failed: ['warning', 'Email failed — retrying'],
  needs_attention: ['danger', 'Email not delivered'],
};

function ReportDetail({ id, type, onChanged }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [flash, setFlash] = useState('');

  const load = useCallback(() => {
    setError('');
    getReport(id)
      .then((res) => setReport(res.report))
      .catch((err) => setError(err?.message ?? 'Could not load the report.'));
  }, [id]);

  useEffect(() => { setReport(null); load(); }, [load]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!report) return <div className="text-muted small p-3">Loading…</div>;

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await setReportStatus({ id, status });
      setReport((r) => ({ ...r, status }));
      onChanged?.({ id, status });
    } catch (err) {
      setFlash(err?.message ?? 'Could not change the status.');
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addReportNote({ id, text: note.trim() });
      setNote('');
      load();
    } catch (err) {
      setFlash(err?.message ?? 'Could not save the note.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const res = await resendReportEmail(id);
      setFlash(res.sent ? 'Email sent.' : `Still failing: ${res.code ?? 'unknown error'}`);
      load();
    } catch (err) {
      setFlash(err?.message ?? 'Resend failed.');
    } finally {
      setBusy(false);
    }
  };

  const fields = type === 'bug'
    ? [['What happened', report.description], ['Steps to reproduce', report.steps], ['Expected', report.expected]]
    : [['What they would like', report.description], ['Problem it solves', report.problem]];
  const emailState = EMAIL_LABEL[report.email?.status] ?? ['secondary', report.email?.status ?? '—'];
  const teacherEmail = report.submittedBy?.email;
  const replySubject = encodeURIComponent(`Re: ${report.number} — ${report.title}`);

  return (
    <div data-testid="report-detail">
      <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
        <div>
          <div className="small text-muted">{report.number}</div>
          <h3 className="h5 fw-bold mb-1">{report.title}</h3>
          <div className="small text-muted">
            {report.teacher} · {age(report.createdAt)}
            {report.severity && <> · <span className="text-capitalize">{report.severity}</span></>}
            {report.urgency && <> · {report.urgency === 'soon' ? 'Wanted soon' : 'Whenever'}</>}
          </div>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <label className="visually-hidden" htmlFor={`status-${id}`}>Status</label>
          <select
            id={`status-${id}`}
            className="form-select form-select-sm"
            value={report.status}
            disabled={busy}
            onChange={(e) => changeStatus(e.target.value)}
            data-testid="report-status-select"
          >
            {statusesFor(type).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          {teacherEmail && (
            <a className="btn btn-sm btn-outline-primary text-nowrap" href={`mailto:${teacherEmail}?subject=${replySubject}`}>
              <i className="bi bi-reply me-1" aria-hidden="true" />Reply by email
            </a>
          )}
        </div>
      </div>

      {flash && <div className="alert alert-info py-1 px-2 small mt-2 mb-0" role="status">{flash}</div>}

      {fields.filter(([, v]) => v).map(([label, value]) => (
        <div key={label} className="mt-3">
          <div className="fw-semibold small">{label}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{value}</div>
        </div>
      ))}

      {report.attachments?.length > 0 && (
        <div className="mt-3">
          <div className="fw-semibold small mb-1">Screenshots</div>
          <div className="d-flex gap-2 flex-wrap">
            {report.attachments.map((a) => (
              <button key={a.index} type="button" className="report-shot" onClick={() => setLightbox(a)}
                aria-label={`Open screenshot ${a.index + 1}`} disabled={!a.url}>
                {a.thumbUrl ? <img src={a.thumbUrl} alt="" /> : <span className="small text-muted p-2 d-block">Unavailable</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <details className="mt-3 small">
        <summary>Context</summary>
        <ul className="mb-0 text-muted">
          {Object.entries(report.context ?? {}).filter(([k, v]) => v && k !== 'flags').map(([k, v]) => (
            <li key={k}><span className="text-capitalize">{k}</span>: {String(v)}</li>
          ))}
        </ul>
      </details>

      <div className="mt-3 d-flex align-items-center gap-2 small">
        <span className={`badge text-bg-${emailState[0]}`}>{emailState[1]}</span>
        {report.email?.recipient && <span className="text-muted">to {report.email.recipient}</span>}
        {report.email?.status !== 'sent' && report.email?.lastError && (
          <span className="text-danger text-truncate" title={report.email.lastError}>{report.email.lastError}</span>
        )}
        <button type="button" className="btn btn-link btn-sm p-0 ms-auto" onClick={resend} disabled={busy}>Resend</button>
      </div>

      <div className="mt-3">
        <div className="fw-semibold small mb-1">Internal notes</div>
        {(report.internalNotes ?? []).length === 0
          ? <div className="small text-muted">None yet. Only you see these.</div>
          : (
            <ul className="list-unstyled small mb-2">
              {report.internalNotes.map((n, i) => (
                <li key={i} className="border-start ps-2 mb-1">
                  <span className="text-muted">{n.at ? new Date(n.at).toLocaleString() : ''}</span>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                </li>
              ))}
            </ul>
          )}
        <form className="d-flex gap-2" onSubmit={saveNote}>
          <label className="visually-hidden" htmlFor={`note-${id}`}>Add a note</label>
          <input id={`note-${id}`} className="form-control form-control-sm" value={note} maxLength={2000}
            onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
          <button type="submit" className="btn btn-sm btn-outline-secondary" disabled={busy || !note.trim()}>Add</button>
        </form>
      </div>

      {lightbox && (
        <Modal title={`Screenshot ${lightbox.index + 1}`} onClose={() => setLightbox(null)} footer={null} wide>
          <div className="report-lightbox">
            <img src={lightbox.url} alt={`Screenshot ${lightbox.index + 1} for ${report.number}`} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ReportsInbox({ type, initialReportId = null, onCountsChange }) {
  // "New" by default; a deep link opens the report whatever its status, so it
  // starts on "All".
  const [status, setStatus] = useState(initialReportId ? '' : 'new');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(initialReportId);

  const load = useCallback(async ({ append = false, from = null } = {}) => {
    setLoading(true);
    setError('');
    try {
      const res = await listReports({ type, status: status || undefined, cursor: from });
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setCounts(res.counts ?? {});
      setCursor(res.nextCursor ?? null);
      onCountsChange?.(type, res.counts ?? {});
    } catch (err) {
      setError(err?.message ?? 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [type, status, onCountsChange]);

  useEffect(() => { load(); }, [load]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chips = [['', 'All', total], ...statusesFor(type).map((s) => [s, STATUS_LABELS[s], counts[s] ?? 0])];

  const onChanged = ({ id, status: next }) => {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: next } : r)));
    load();
  };

  return (
    <div className="row g-3">
      <div className="col-lg-5">
        <div className="d-flex flex-wrap gap-1 mb-2" role="group" aria-label="Filter by status">
          {chips.map(([id, label, n]) => (
            <button key={id || 'all'} type="button"
              className={`btn btn-sm ${status === id ? 'btn-dark' : 'btn-outline-secondary'}`}
              aria-pressed={status === id} onClick={() => setStatus(id)}>
              {label} <span className="badge text-bg-light ms-1">{n}</span>
            </button>
          ))}
        </div>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <div className="list-group" data-testid={`inbox-${type}`}>
          {items.map((r) => {
            const due = dueState(r.createdAt, r.responseDueAt);
            const closed = ['resolved', 'wont_fix', 'declined', 'shipped'].includes(r.status);
            return (
              <button key={r.id} type="button"
                className={`list-group-item list-group-item-action report-list-item${selected === r.id ? ' active' : ''}`}
                onClick={() => setSelected(r.id)} aria-current={selected === r.id}>
                <div className="d-flex justify-content-between gap-2">
                  <span className="fw-semibold text-truncate">{r.number} · {r.title}</span>
                  <span className={`badge text-bg-${STATUS_TONE[r.status] ?? 'secondary'}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                </div>
                <div className="d-flex justify-content-between small mt-1 gap-2">
                  <span className="text-muted text-truncate">
                    {r.teacher}{r.severity ? ` · ${r.severity}` : ''}{r.urgency ? ` · ${r.urgency}` : ''}{r.attachments ? ` · ${r.attachments} 📎` : ''}
                  </span>
                  {!closed && <span className={`report-due-${due.tone} text-nowrap`}>{due.label}</span>}
                </div>
              </button>
            );
          })}
          {!loading && items.length === 0 && (
            <div className="list-group-item text-muted small">Nothing here.</div>
          )}
        </div>
        {cursor && (
          <button type="button" className="btn btn-link btn-sm" disabled={loading}
            onClick={() => load({ append: true, from: cursor })}>
            Show older
          </button>
        )}
        {loading && <div className="small text-muted mt-2">Loading…</div>}
      </div>
      <div className="col-lg-7">
        <div className="card">
          <div className="card-body">
            {selected
              ? <ReportDetail key={selected} id={selected} type={type} onChanged={onChanged} />
              : <div className="text-muted small">Select a report to read it.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
