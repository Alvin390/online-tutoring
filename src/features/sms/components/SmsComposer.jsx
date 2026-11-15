import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@components/ui/Modal';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useFlag } from '@shared/config/FlagsContext';
import { listSmsPeople, previewSms, startSms, sendSmsChunk, cancelSms } from '@services/api/sms';
import { buildWaLink } from '@utils/waLink';
import { SMS_MAX_CHARS, SMS_UNIT_CHARS } from '@utils/smsText';
import { measure, renderWhatsApp, toTemplate, toFriendly, stripUnsupported } from '../smsDraft';
import MessageBox from './MessageBox';
import PeoplePicker, { personKey } from './PeoplePicker';
import SmsHistory, { SmsDetail } from './SmsHistory';

/**
 * Messages — 008Fixes / 09 (owner, 2026-11-14/15): the same flow as before,
 * with two modes.
 *   SMS (default): to everyone, a session, a class, chosen students or staff
 *     (choosing is Gold, as for WhatsApp). A live counter on the LONGEST
 *     parent's version (at most two SMS, naming whose); Review shows who, how
 *     many SMS and the cost; Send goes chunk by chunk with a progress bar;
 *     then delivery per person and totals.
 *   WhatsApp (one person): pick one student or staff member, write, Open
 *     WhatsApp (free, wa.me). No campaign, no queue.
 * `preset` (a draft from Recent actions: { template, filterValues, note })
 * opens SMS with that text and those people chosen.
 */

const SEND_TO = [
  { id: 'all', label: 'All students' },
  { id: 'session', label: 'A session', gold: true },
  { id: 'class', label: 'A class', gold: true },
  { id: 'individual', label: 'Choose students', gold: true },
  { id: 'staff', label: 'Staff (teachers)', gold: true },
];
const wait = (s) => new Promise((resolve) => { setTimeout(resolve, s * 1000); });

export default function SmsComposer({ setup, preset = null }) {
  const { tierRank, isSuperadmin } = useAuthState();
  const advanced = useFlag('whatsapp.advanced');
  const feesOn = useFlag('fees.enabled');
  const canChoose = (isSuperadmin || (tierRank ?? 0) >= 3) && advanced;

  const [view, setView] = useState('compose'); // compose | history | campaign
  const [mode, setMode] = useState('sms');
  // A prepared draft may hold characters SMS can't carry: dropped up front.
  const [text, setText] = useState(() => (preset?.template ? stripUnsupported(toFriendly(preset.template)).text : ''));
  const [people, setPeople] = useState(null);
  const [peopleError, setPeopleError] = useState('');
  // A draft for chosen people never falls back to everyone (if choosing isn't
  // allowed the server refuses it, rather than messaging every parent).
  const [sendTo, setSendTo] = useState(preset?.filterValues?.length ? 'individual' : 'all');
  const [sessions, setSessions] = useState(new Set());
  const [classes, setClasses] = useState(new Set());
  // A draft from Recent actions names its people as "session:phone".
  const [chosen, setChosen] = useState(() => new Set(preset?.filterValues ?? []));
  const [one, setOne] = useState(new Set());
  const [review, setReview] = useState(null); // { busy, data, error }
  const [progress, setProgress] = useState(null); // { campaignId, total, sent, failed, waiting, done, error }
  const [campaignId, setCampaignId] = useState(null);
  const cancelled = useRef(false);

  useEffect(() => {
    listSmsPeople().then(setPeople).catch((err) => setPeopleError(err?.message || 'Could not load who can be messaged.'));
  }, []);

  const students = useMemo(() => people?.students ?? [], [people]);
  const staff = useMemo(() => people?.staff ?? [], [people]);
  const allSessions = useMemo(() => [...new Map(students.map((p) => [p.session, p.sessionName ?? p.session])).entries()], [students]);
  const allClasses = useMemo(() => [...new Set(students.map((p) => p.class).filter(Boolean))].sort(), [students]);

  const audience = useMemo(() => {
    if (sendTo === 'all') return students;
    if (sendTo === 'session') return students.filter((p) => sessions.has(p.session));
    if (sendTo === 'class') return students.filter((p) => classes.has(p.class));
    if (sendTo === 'individual') return students.filter((p) => chosen.has(personKey(p)));
    return staff;
  }, [sendTo, students, staff, sessions, classes, chosen]);

  const filter = useMemo(() => {
    if (sendTo === 'session') return { type: 'session', values: [...sessions] };
    if (sendTo === 'class') return { type: 'class', values: [...classes] };
    if (sendTo === 'individual') return { type: 'individual', values: [...chosen] };
    return { type: sendTo };
  }, [sendTo, sessions, classes, chosen]);

  const schoolName = setup?.schoolName ?? '';
  const counter = useMemo(() => measure(text, audience, schoolName), [text, audience, schoolName]);
  const canReview = text.trim() && audience.length > 0 && counter.over === 0 && !progress;

  const openReview = async () => {
    setReview({ busy: true, data: null, error: '' });
    try {
      setReview({ busy: false, data: await previewSms(toTemplate(text), filter), error: '' });
    } catch (err) {
      setReview({ busy: false, data: null, error: err?.message || 'Could not check the message.' });
    }
  };

  const send = async () => {
    const total = review?.data?.recipients ?? audience.length;
    setReview(null);
    cancelled.current = false;
    setCampaignId(null);
    setProgress({ total, sent: 0, failed: 0, waiting: 0, done: false, error: '' });
    try {
      const started = await startSms(toTemplate(text), filter);
      setCampaignId(started.campaignId);
      if (cancelled.current) await cancelSms(started.campaignId).catch(() => {});
      let sent = 0;
      let failed = 0;
      for (let guard = 0; guard < 2000 && !cancelled.current; guard += 1) {
        const r = await sendSmsChunk(started.campaignId);
        sent += r.sent ?? 0;
        failed += r.failed ?? 0;
        setProgress((p) => ({ ...p, sent, failed, waiting: r.retryAfter ?? 0 }));
        if (r.done || r.cancelled) break;
        if (r.retryAfter) await wait(r.retryAfter);
      }
      setProgress((p) => ({ ...p, done: true, waiting: 0 }));
    } catch (err) {
      setProgress((p) => ({ ...p, done: true, waiting: 0, error: err?.message || 'Sending stopped.' }));
    }
  };

  const cancel = async () => {
    cancelled.current = true;
    if (campaignId) await cancelSms(campaignId).catch(() => {});
  };

  // ---------------------------------------------------------- WhatsApp, one
  const person = useMemo(() => [...students, ...staff].find((p) => one.has(personKey(p))) ?? null, [one, students, staff]);
  const waText = person ? renderWhatsApp(text, person, schoolName) : '';
  const wa = person ? buildWaLink(person.phone, waText) : null;

  if (view === 'history') {
    return (
      <div>
        <div className="d-flex gap-2 mb-3">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setView('compose')}><i className="bi bi-pencil me-1" aria-hidden="true" />Write a message</button>
        </div>
        <SmsHistory />
      </div>
    );
  }
  if (view === 'campaign' && campaignId) {
    return (
      <div>
        <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={() => { setView('compose'); setProgress(null); setCampaignId(null); setText(''); }}>
          <i className="bi bi-pencil me-1" aria-hidden="true" />Write another message
        </button>
        <SmsDetail campaignId={campaignId} />
      </div>
    );
  }

  return (
    <div className="card" data-testid="sms-composer">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div className="btn-group" role="group" aria-label="Send by">
            <button type="button" className={`btn btn-sm ${mode === 'sms' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('sms'); setText((t) => stripUnsupported(t).text); }} aria-pressed={mode === 'sms'}>
              <i className="bi bi-chat-text me-1" aria-hidden="true" />SMS
            </button>
            <button type="button" className={`btn btn-sm ${mode === 'whatsapp' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setMode('whatsapp')} aria-pressed={mode === 'whatsapp'}>
              <i className="bi bi-whatsapp me-1" aria-hidden="true" />WhatsApp (one person)
            </button>
          </div>
          <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={() => setView('history')}>
            <i className="bi bi-clock-history me-1" aria-hidden="true" />Sent messages
          </button>
        </div>

        {peopleError && <div className="alert alert-danger small py-2" role="alert">{peopleError}</div>}

        {mode === 'sms' ? (
          <>
            <MessageBox value={text} onChange={setText} sms feesOn={feesOn} schoolName={schoolName}>
              <div className={`small mt-1 ${counter.over ? 'text-danger fw-semibold' : 'text-muted'}`} data-testid="sms-counter" aria-live="polite">
                {counter.length} / {SMS_MAX_CHARS} characters · {counter.units} SMS
                {counter.studentName && audience.length > 1 ? <> · longest for <strong>{counter.studentName}</strong></> : null}
                {counter.over > 0 && <> · Too long for 2 SMS. Shorten it by {counter.over} character{counter.over === 1 ? '' : 's'}.</>}
                {!counter.over && counter.length > SMS_UNIT_CHARS && <> · 2 SMS per parent</>}
              </div>
            </MessageBox>

            <div className="mt-3">
              <label className="form-label fw-semibold mb-1" htmlFor="send-to">Send to</label>
              <select id="send-to" className="form-select" style={{ maxWidth: 280 }} value={sendTo} onChange={(e) => setSendTo(e.target.value)}>
                {SEND_TO.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.gold && !canChoose}>{o.label}{o.gold && !canChoose ? ' (Gold)' : ''}</option>
                ))}
              </select>
              {!canChoose && <div className="form-text">Silver sends to all students. Gold can choose a session, a class, students or staff.</div>}

              {sendTo === 'session' && (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {allSessions.map(([id, name]) => (
                    <label key={id} className="form-check-label d-flex align-items-center gap-1">
                      <input type="checkbox" className="form-check-input m-0" checked={sessions.has(id)} onChange={() => setSessions((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
                      {name}
                    </label>
                  ))}
                </div>
              )}
              {sendTo === 'class' && (
                <div className="d-flex flex-wrap gap-2 mt-2">
                  {allClasses.map((c) => (
                    <label key={c} className="form-check-label d-flex align-items-center gap-1">
                      <input type="checkbox" className="form-check-input m-0" checked={classes.has(c)} onChange={() => setClasses((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; })} />
                      {c}
                    </label>
                  ))}
                </div>
              )}
              {sendTo === 'individual' && (
                <div className="mt-2"><PeoplePicker people={students} selected={chosen} onChange={setChosen} /></div>
              )}
              <div className="small text-muted mt-2" data-testid="sms-audience">
                {people ? `${audience.length} ${audience.length === 1 ? 'person' : 'people'}` : 'Loading…'}
                {audience.length > 0 && counter.cost ? ` · about ${counter.totalUnits} SMS · KES ${counter.cost.toFixed(2)}` : ''}
                {' '}(people who asked not to get messages are left out)
              </div>
            </div>

            {progress ? (
              <div className="mt-3" data-testid="sms-progress">
                <div className="progress" role="progressbar" aria-valuenow={progress.sent + progress.failed} aria-valuemin={0} aria-valuemax={progress.total}>
                  <div className="progress-bar" style={{ width: `${Math.round(((progress.sent + progress.failed) / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
                <div className="small mt-1">
                  {progress.sent} sent{progress.failed ? `, ${progress.failed} failed` : ''} of {progress.total}
                  {progress.waiting ? ` · SMS is busy, carrying on in ${progress.waiting} s` : ''}
                </div>
                {progress.error && <div className="alert alert-warning small py-2 mt-2 mb-0" role="alert">{progress.error}</div>}
                <div className="d-flex gap-2 mt-2">
                  {!progress.done && <button type="button" className="btn btn-sm btn-outline-danger" onClick={cancel}>Stop sending</button>}
                  {progress.done && campaignId && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setView('campaign')}>See delivery</button>
                  )}
                  {progress.done && !campaignId && (
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setProgress(null)}>Back to the message</button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary mt-3" disabled={!canReview || review?.busy} onClick={openReview}>
                {review?.busy ? 'Checking…' : 'Review and send'}
              </button>
            )}
            {review?.error && <div className="alert alert-danger small py-2 mt-2" role="alert">{review.error}</div>}
          </>
        ) : (
          <>
            <p className="small text-muted">One student or staff member at a time, from your own WhatsApp. Free.</p>
            <PeoplePicker people={[...students, ...staff]} selected={one} onChange={setOne} single label="Choose one person" />
            <div className="mt-3">
              <MessageBox value={text} onChange={setText} sms={false} feesOn={feesOn} schoolName={schoolName} />
            </div>
            {person && (
              <div className="mt-2 small">
                <div className="text-muted">To {person.studentName} (…{String(person.phone).slice(-3)}):</div>
                <div className="border rounded p-2 bg-light" style={{ whiteSpace: 'pre-wrap' }}>{waText || '—'}</div>
              </div>
            )}
            {wa?.valid && waText ? (
              <a className="btn btn-success mt-3" href={wa.url} target="_blank" rel="noopener noreferrer">
                <i className="bi bi-whatsapp me-1" aria-hidden="true" />Open WhatsApp
              </a>
            ) : (
              <button type="button" className="btn btn-success mt-3" disabled>
                <i className="bi bi-whatsapp me-1" aria-hidden="true" />Open WhatsApp
              </button>
            )}
          </>
        )}
      </div>

      {review?.data && (
        <Modal
          title="Send this SMS?"
          onClose={() => setReview(null)}
          onConfirm={send}
          confirmLabel={`Send to ${review.data.recipients}`}
          footer={review.data.enoughCredit === false
            ? <button type="button" className="btn btn-secondary" onClick={() => setReview(null)}>Close</button>
            : undefined}
        >
          <p className="mb-2">
            <strong>{review.data.recipients}</strong> {review.data.recipients === 1 ? 'person' : 'people'} · <strong>{review.data.units}</strong> SMS ·
            {' '}<strong>KES {Number(review.data.cost).toFixed(2)}</strong>
          </p>
          {review.data.longest && (
            <>
              <div className="small text-muted">The longest message ({review.data.longest.studentName ?? 'one parent'}, {review.data.longest.length} characters):</div>
              <p className="border rounded p-2 small bg-light" style={{ whiteSpace: 'pre-wrap' }}>{review.data.longest.text}</p>
            </>
          )}
          {review.data.balance != null && (
            <p className={`small mb-0 ${review.data.enoughCredit === false ? 'text-danger' : 'text-muted'}`}>
              SMS credit: KES {Number(review.data.balance).toFixed(2)}
              {review.data.enoughCredit === false ? ` — not enough: KES ${review.data.reserve} is kept for check-in codes.` : ''}
            </p>
          )}
          <p className="small text-muted mb-0 mt-1">Sent from {setup?.sender || 'HASHBACKSMS'}.</p>
        </Modal>
      )}
    </div>
  );
}
