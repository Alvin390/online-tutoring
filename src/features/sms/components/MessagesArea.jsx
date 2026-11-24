import { useCallback, useEffect, useState } from 'react';
import Modal from '@components/ui/Modal';
import { getSmsSetup } from '@services/api/sms';
import SmsSetup from './SmsSetup';

/**
 * The Messages tab with SMS on — 008Fixes / 08.
 *
 * Reads the school's SMS setup once (no listener). Locked: "Set up SMS first".
 * Unlocked: `children(setup)` — the composer (Phase 09) — with a small Setup
 * link to change the school name later. Right after unlocking, a short notice
 * explains the generic sender (shown once on this device).
 */

const NOTICE_KEY = 'ot.smsSenderNotice.v1';
const seenNotice = () => { try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; } };
const markNotice = () => { try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* shown again next time */ } };

export default function MessagesArea({ children }) {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      // 013Fixes / 16: the school's SMS units ride along with the setup.
      const result = await getSmsSetup();
      setSetup({ ...result.setup, units: result.units ?? null });
    } catch (err) {
      setError(err?.message || 'Could not load the SMS setup.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="alert alert-danger d-flex justify-content-between align-items-center" role="alert">
        <span>{error}</span>
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!setup) {
    return <div className="text-center py-4"><span className="spinner-border spinner-border-sm text-primary" role="status"><span className="visually-hidden">Loading…</span></span></div>;
  }

  if (!setup.unlocked) {
    return (
      <SmsSetup
        setup={setup}
        onChange={setSetup}
        onUnlocked={(next) => { setSetup(next); if (!seenNotice()) setNotice(true); }}
      />
    );
  }

  return (
    <>
      <div className="d-flex justify-content-end mb-2">
        <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          <i className="bi bi-gear me-1" aria-hidden="true" />
          Setup
        </button>
      </div>
      {editing && (
        <div className="mb-3">
          <SmsSetup setup={setup} onChange={setSetup} editNameOnly onDone={() => setEditing(false)} />
        </div>
      )}
      {children(setup)}
      {notice && (
        <Modal
          title="SMS is ready"
          onClose={() => { markNotice(); setNotice(false); }}
          footer={(
            <button type="button" className="btn btn-primary" onClick={() => { markNotice(); setNotice(false); }}>
              Got it
            </button>
          )}
        >
          <p className="mb-2">
            Messages will show as from <strong>{setup.sender || 'HASHBACKSMS'}</strong>, a shared sender. Parents
            won&apos;t see your name unless you add it.
          </p>
          <p className="mb-0">
            Tip: start messages with the <strong>School name</strong> button
            {setup.schoolName ? <> (&quot;{setup.schoolName}&quot;)</> : null}.
          </p>
        </Modal>
      )}
    </>
  );
}
