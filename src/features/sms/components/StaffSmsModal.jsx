import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '@components/ui/Modal';
import { getSmsSetup, sendSmsToOne, refreshSms } from '@services/api/sms';
import { SMS_MAX_CHARS } from '@utils/smsText';
import { measure, toTemplate } from '../smsDraft';
import MessageBox from './MessageBox';

/**
 * SMS to one staff member — 008Fixes / 10 (owner, HashBack answer 10: an SMS
 * button on each staff row, a small pop-up). The same box, buttons and
 * counter as the composer; [Student name] is the staff member's own name.
 * Sends with `sendOne`; "Sent", then "Delivered" once HashBack confirms
 * (asked again on Check, and when the pop-up is reopened). Locked until the
 * school's SMS setup is done, with a link to it.
 */

// The last SMS to each person in this visit, so reopening shows (and checks) it.
const lastSent = new Map();
const DELIVERY = { sent: 'Sent', delivered: 'Delivered', failed: 'Not delivered', queued: 'Waiting', sending: 'Sending' };

export default function StaffSmsModal({ person, session, sessionName = '', onClose }) {
  const key = `${session}:${person.id}`;
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(() => lastSent.get(key) ?? null); // { campaignId, status }

  const check = async (campaignId) => {
    try {
      const res = await refreshSms(campaignId);
      const status = res.recipients?.[0]?.status ?? 'sent';
      const next = { campaignId, status };
      lastSent.set(key, next);
      setSent(next);
    } catch {
      /* the status stays as it was; Check can be pressed again */
    }
  };

  useEffect(() => {
    getSmsSetup().then((r) => setSetup(r.setup)).catch((err) => setError(err?.message || 'Could not load the SMS setup.'));
    const previous = lastSent.get(key);
    if (previous && previous.status !== 'delivered' && previous.status !== 'failed') check(previous.campaignId);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counter = useMemo(
    // Filled as the server fills it (the session's name too), so the counter never undercounts.
    () => measure(text, [{ studentName: person.studentName ?? '', class: person.class ?? '', sessionName }], setup?.schoolName ?? ''),
    [text, person, sessionName, setup],
  );

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await sendSmsToOne(session, person.id, toTemplate(text));
      const next = { campaignId: res.campaignId, status: 'sent' };
      lastSent.set(key, next);
      setSent(next);
      setText('');
    } catch (err) {
      setError(err?.message || 'The SMS was not sent.');
    } finally {
      setBusy(false);
    }
  };

  const name = person.studentName || 'this staff member';
  const locked = setup && !setup.unlocked;
  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
      {!locked && setup && (
        <button type="button" className="btn btn-primary" onClick={send}
          disabled={busy || !text.trim() || counter.over > 0}>
          {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : null}Send SMS
        </button>
      )}
    </>
  );

  return (
    <Modal title={`SMS to ${name}`} onClose={() => { if (!busy) onClose(); }} footer={footer}>
      <p className="small text-muted mb-2">To …{String(person.id).slice(-3)}. [Student name] is {name}&apos;s own name here.</p>
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      {!setup && !error && <div className="text-muted small">Loading…</div>}
      {locked && (
        <div className="alert alert-info small mb-0" role="status">
          Set up SMS first: the school name and a test SMS to your phone.{' '}
          <Link to="/dashboard/whatsapp" onClick={onClose}>Open Messages</Link>
        </div>
      )}
      {setup && !locked && (
        <>
          {sent && (
            <div className="d-flex align-items-center gap-2 mb-2 small" data-testid="staff-sms-status">
              <span className={`badge ${sent.status === 'delivered' ? 'text-bg-success' : sent.status === 'failed' ? 'text-bg-danger' : 'text-bg-info'}`}>
                {DELIVERY[sent.status] ?? sent.status}
              </span>
              <span className="text-muted">last SMS</span>
              {sent.status !== 'delivered' && sent.status !== 'failed' && (
                <button type="button" className="btn btn-sm btn-link p-0" onClick={() => check(sent.campaignId)}>Check</button>
              )}
            </div>
          )}
          <MessageBox value={text} onChange={setText} sms schoolName={setup.schoolName} starters={false}>
            <div className={`small mt-1 ${counter.over ? 'text-danger fw-semibold' : 'text-muted'}`} data-testid="staff-sms-counter" aria-live="polite">
              {counter.length} / {SMS_MAX_CHARS} characters · {counter.units} SMS
              {counter.over > 0 && <> · Too long for 2 SMS. Shorten it by {counter.over} character{counter.over === 1 ? '' : 's'}.</>}
            </div>
          </MessageBox>
        </>
      )}
    </Modal>
  );
}
