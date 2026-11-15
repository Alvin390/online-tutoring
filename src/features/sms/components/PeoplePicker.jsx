import { useMemo, useState } from 'react';

/**
 * Choose people — 008Fixes / 09 (owner: "a search bar and multi-select, like
 * the block selection"). Search by name, phone ending or class; filter by
 * session; tick one by one or "Select all shown". `single` picks one person
 * (WhatsApp mode). Keys are "session:phone" (one number can be registered in
 * two sessions).
 */
export const personKey = (p) => `${p.session}:${p.phone}`;
const SHOW = 60;

export default function PeoplePicker({ people, selected, onChange, single = false, label = 'Choose students' }) {
  const [q, setQ] = useState('');
  const [session, setSession] = useState('');
  const [limit, setLimit] = useState(SHOW);
  const sessions = useMemo(() => [...new Map(people.map((p) => [p.session, p.sessionName ?? p.session])).entries()], [people]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return people.filter((p) => (!session || p.session === session)
      && (!needle
        || String(p.studentName ?? '').toLowerCase().includes(needle)
        || String(p.class ?? '').toLowerCase().includes(needle)
        || (digits.length >= 3 && String(p.phone).replace(/\D/g, '').includes(digits))));
  }, [people, q, session]);

  const toggle = (key) => {
    if (single) { onChange(new Set([key])); return; }
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  const selectAllShown = () => onChange(new Set([...selected, ...shown.map(personKey)]));

  return (
    <div className="people-picker" data-testid="people-picker">
      <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
        <input
          type="search"
          className="form-control form-control-sm"
          style={{ maxWidth: 260 }}
          placeholder="Search name, class or phone"
          aria-label={`${label}: search`}
          value={q}
          onChange={(e) => { setQ(e.target.value); setLimit(SHOW); }}
        />
        {sessions.length > 1 && (
          <select className="form-select form-select-sm w-auto" aria-label="Session" value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="">All sessions</option>
            {sessions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {!single && (
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAllShown} disabled={shown.length === 0}>
              Select all shown ({shown.length})
            </button>
            {selected.size > 0 && (
              <>
                <span className="badge rounded-pill text-bg-primary" data-testid="chosen-count">{selected.size} chosen</span>
                <button type="button" className="btn btn-sm btn-link" onClick={() => onChange(new Set())}>Clear</button>
              </>
            )}
          </>
        )}
      </div>
      <ul className="list-group list-group-flush border rounded" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {shown.length === 0 && <li className="list-group-item small text-muted">Nobody matches.</li>}
        {shown.slice(0, limit).map((p) => {
          const key = personKey(p);
          return (
            <li key={key} className="list-group-item py-1">
              <label className="d-flex align-items-center gap-2 mb-0 w-100" style={{ cursor: 'pointer' }}>
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? 'pick-one' : undefined}
                  className="form-check-input m-0"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                />
                <span className="flex-grow-1 text-truncate">
                  {p.studentName ?? 'No name'}
                  <span className="small text-muted"> · {p.class ?? ''}{sessions.length > 1 ? ` · ${p.sessionName ?? p.session}` : ''} · …{String(p.phone).slice(-3)}</span>
                </span>
              </label>
            </li>
          );
        })}
        {shown.length > limit && (
          <li className="list-group-item py-1 text-center">
            <button type="button" className="btn btn-sm btn-link" onClick={() => setLimit((n) => n + SHOW)}>Show more ({shown.length - limit} not shown)</button>
          </li>
        )}
      </ul>
    </div>
  );
}
