import { useState } from 'react';
import { m } from 'framer-motion';
import Modal from '@shared/components/ui/Modal';
import { parseNumberInput } from '@utils/admissionNumberInput';
import { maskPhone } from './maskPhone';
import { NUMBER_STEP as COPY } from './numberCopy';

/**
 * "Type your admission number" — 014Fixes / 03 (owner, 2026-11-24).
 *
 * Everyone starts with the phone, exactly as with admission numbers off. A
 * phone that has a number comes here (the server answered
 * `number_required`): the number for this session, the phone shown back
 * masked with "Change", and "Forgot your admission number?" (a pop-up: ask
 * your teacher; automated later).
 *
 * `refusal` ({ code, message }) is the server's answer to the last try: a
 * mismatch in the approved words, anything else (another device, duplicate
 * records) in the server's own. Typing hides it until the next try; the
 * number typed is kept for correcting.
 */
export default function NumberStep({
  phone, session, loading = false, waitSeconds = 0, refusal = null, onSubmit, onChangePhone,
}) {
  const [number, setNumber] = useState('');
  const [shapeError, setShapeError] = useState('');
  const [hiddenFor, setHiddenFor] = useState(null);
  const [forgot, setForgot] = useState(false);

  const shown = refusal && refusal !== hiddenFor ? refusal : null;
  const message = shapeError || (shown ? (shown.code === 'number_mismatch' ? COPY.mismatch : shown.message) : '');

  const submit = (e) => {
    e.preventDefault();
    if (!parseNumberInput(number)) { setShapeError(COPY.shape); return; }
    setShapeError('');
    setHiddenFor(null);
    onSubmit(number.trim());
  };

  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="number-step">
      <div className="text-center mb-3">
        <h2 className="fw-bold mb-2">{COPY.title}</h2>
        <p className="text-muted mb-0" data-testid="number-step-phone">
          {COPY.forSession(session)}
          {' · '}
          <strong>{maskPhone(phone)}</strong>
          {' · '}
          <button type="button" className="btn btn-link p-0 align-baseline" onClick={onChangePhone}>{COPY.change}</button>
        </p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="form-label fw-semibold" htmlFor="ot-admission-number">{COPY.label}</label>
        <input
          id="ot-admission-number"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={7}
          autoFocus
          className={`form-control form-control-lg mb-2 ${message ? 'is-invalid' : ''}`}
          placeholder={COPY.placeholder}
          value={number}
          onChange={(e) => { setNumber(e.target.value); setShapeError(''); setHiddenFor(refusal); }}
        />
        {message && <div className="invalid-feedback d-block mb-2" role="alert">{message}</div>}
        <button type="submit" className="btn btn-primary btn-lg w-100 mb-2" disabled={loading || waitSeconds > 0}>
          {loading ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{COPY.checking}</> : COPY.button}
        </button>
      </form>
      <div className="text-center">
        <button type="button" className="btn btn-link small" onClick={() => setForgot(true)}>{COPY.forgotLink}</button>
      </div>
      {forgot && (
        <Modal
          title={COPY.forgotTitle}
          onClose={() => setForgot(false)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setForgot(false)}>{COPY.ok}</button>}
        >
          <p className="mb-0">{COPY.forgotBody(session)}</p>
        </Modal>
      )}
    </m.div>
  );
}
