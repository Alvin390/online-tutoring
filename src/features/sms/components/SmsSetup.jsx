import { useState } from 'react';
import { saveSchoolName, sendSmsTest, unlockSms } from '@services/api/sms';
import { unsupportedChars, normalizeSmsText } from '@utils/smsText';

/**
 * A Kenyan mobile number as typed (07…, 01…, 7…, 254…, +254…) in E.164, or
 * null. Its own small field: sharing the student page's phone input split
 * that page's bundle (+0.5 KB on /:slug).
 */
export function kenyanMobile(typed) {
  const digits = String(typed ?? '').replace(/\D/g, '');
  const national = digits.startsWith('254') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(national) ? `+254${national}` : null;
}

/**
 * "Set up SMS first" — 008Fixes / 08 (owner HashBack answers 1–2).
 *
 *   1. The school name: it becomes the "School name" button in the composer
 *      (parents see messages from the shared sender HASHBACKSMS, so the name
 *      is how they know who is writing). Not forced into every message.
 *   2. A test SMS to her own phone. "Did it arrive?" Yes unlocks SMS; No
 *      offers Try again and who to ask.
 *
 * `onUnlocked(setup)` hands the new setup back (the parent shows the sender
 * notice). `editNameOnly` shows step 1 alone (Setup, later): changing the
 * name never locks SMS again.
 */
export default function SmsSetup({ setup, onChange, onUnlocked, editNameOnly = false, onDone }) {
  const [name, setName] = useState(setup?.schoolName ?? '');
  const [nameState, setNameState] = useState({ busy: false, error: '', saved: Boolean(setup?.schoolName) });
  const [test, setTest] = useState({ busy: false, error: '', sentTo: null });
  const [unlocking, setUnlocking] = useState(false);
  const [notArrived, setNotArrived] = useState(false);
  const [phoneText, setPhoneText] = useState('');
  const phoneE164 = kenyanMobile(phoneText);

  const badChars = unsupportedChars(name);
  const saveName = async (e) => {
    e.preventDefault();
    if (badChars.length || name.trim().length < 2) return;
    setNameState({ busy: true, error: '', saved: false });
    try {
      const res = await saveSchoolName(name);
      setNameState({ busy: false, error: '', saved: true });
      setName(res.setup.schoolName);
      onChange?.(res.setup);
      if (editNameOnly) onDone?.(res.setup);
    } catch (err) {
      setNameState({ busy: false, error: err?.message || 'Could not save the name.', saved: false });
    }
  };

  const sendTest = async (e) => {
    e.preventDefault();
    if (!phoneE164) { setTest({ busy: false, error: 'Enter your phone number, e.g. 0712 345 678.', sentTo: null }); return; }
    setTest({ busy: true, error: '', sentTo: null });
    setNotArrived(false);
    try {
      const res = await sendSmsTest(phoneE164);
      setTest({ busy: false, error: '', sentTo: res.phoneEnding });
    } catch (err) {
      setTest({ busy: false, error: err?.message || 'The test SMS was not sent.', sentTo: null });
    }
  };

  const arrived = async () => {
    setUnlocking(true);
    try {
      const res = await unlockSms();
      onChange?.(res.setup);
      onUnlocked?.(res.setup);
    } catch (err) {
      setTest((t) => ({ ...t, error: err?.message || 'Could not unlock SMS.' }));
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="card" data-testid="sms-setup">
      <div className="card-body">
        {!editNameOnly && (
          <>
            <h2 className="h5 fw-bold mb-1">
              <i className="bi bi-chat-dots me-2" aria-hidden="true" />
              Set up SMS first
            </h2>
            <p className="text-muted small mb-4">Two quick steps. Then you can message parents by SMS.</p>
          </>
        )}

        <form onSubmit={saveName} className="mb-4" noValidate>
          <h3 className="h6 fw-semibold">{editNameOnly ? 'School name' : '1. Your school name'}</h3>
          <p className="small text-muted mb-2">
            Messages come from a shared sender, so parents won&apos;t see who is writing unless you say.
            Your school name becomes a <strong>School name</strong> button you can add to any message.
          </p>
          <div className="d-flex gap-2 flex-wrap">
            <input
              className={`form-control ${badChars.length ? 'is-invalid' : ''}`}
              style={{ maxWidth: 320 }}
              aria-label="School name"
              maxLength={30}
              placeholder="e.g. Focus Online School"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameState((s) => ({ ...s, saved: false, error: '' })); }}
            />
            <button type="submit" className="btn btn-primary" disabled={nameState.busy || badChars.length > 0 || name.trim().length < 2}>
              {nameState.busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {badChars.length > 0 && <div className="invalid-feedback d-block">SMS can&apos;t carry {badChars.join(' ')}. Use plain letters.</div>}
          {nameState.error && <div className="text-danger small mt-1" role="alert">{nameState.error}</div>}
          {nameState.saved && !nameState.error && (
            <div className="text-success small mt-1">
              <i className="bi bi-check-circle-fill me-1" aria-hidden="true" />
              Saved: &quot;{normalizeSmsText(name).trim()}&quot;
            </div>
          )}
        </form>

        {!editNameOnly && (
          <form onSubmit={sendTest} noValidate>
            <h3 className="h6 fw-semibold">2. Send a test to your phone</h3>
            <p className="small text-muted mb-2">
              We&apos;ll send &quot;Test from {nameState.saved ? normalizeSmsText(name).trim() : 'your school'}: SMS is working.&quot;
            </p>
            <div className="mb-3" style={{ maxWidth: 360 }}>
              <label className="form-label fw-semibold" htmlFor="sms-test-phone">Your phone number</label>
              <div className="input-group">
                <span className="input-group-text">+254</span>
                <input
                  id="sms-test-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  className={`form-control ${phoneE164 ? 'is-valid' : ''}`}
                  placeholder="0712 345 678"
                  maxLength={16}
                  value={phoneText}
                  onChange={(e) => setPhoneText(e.target.value)}
                />
              </div>
              <div className="form-text">A Kenyan mobile number; a leading 0 is fine.</div>
            </div>
            <button type="submit" className="btn btn-outline-primary" disabled={test.busy || !nameState.saved}>
              {test.busy ? 'Sending…' : test.sentTo ? 'Send again' : 'Send test'}
            </button>
            {!nameState.saved && <div className="form-text">Save the school name first.</div>}
            {test.error && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{test.error}</div>}

            {test.sentTo && (
              <div className="alert alert-light border mt-3 mb-0" role="group" aria-label="Did it arrive?">
                <p className="mb-2">Sent to the number ending {test.sentTo}. <strong>Did it arrive?</strong></p>
                <div className="d-flex gap-2 flex-wrap">
                  <button type="button" className="btn btn-success" onClick={arrived} disabled={unlocking}>
                    {unlocking ? 'Unlocking…' : 'Yes, it arrived'}
                  </button>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setNotArrived(true)} disabled={unlocking}>
                    No
                  </button>
                </div>
                {notArrived && (
                  <p className="small text-muted mt-2 mb-0" role="status">
                    Give it a minute, check the number, then tap <strong>Send again</strong>. If it still doesn&apos;t
                    arrive, ask the owner to check the SMS credit.
                  </p>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
