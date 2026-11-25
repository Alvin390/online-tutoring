import { m } from 'framer-motion';
import { maskPhone } from './maskPhone';
import Rich from './Rich';
import { NOT_REGISTERED as COPY } from './numberCopy';

/**
 * "We couldn't find this number" — 014Fixes / 07 (012Fixes N1, option 2
 * reworded: a student registered under another number checks in with that
 * one, and switches at the code step). Only with admission numbers on; off,
 * an unknown number still goes straight to the form, as before.
 */
export default function NotRegistered({ phone, onRegister, onBack }) {
  return (
    <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card" data-testid="not-registered">
      <div className="text-center mb-3">
        <h2 className="fw-bold mb-2 h3">{COPY.title}</h2>
        <p className="text-muted mb-0">{COPY.why(maskPhone(phone))}</p>
      </div>
      <p className="fw-semibold mb-2">{COPY.todoTitle}</p>
      <ul className="small mb-3 ps-3">
        {COPY.todo.map((line) => <li key={line} className="mb-1"><Rich text={line} /></li>)}
      </ul>
      <p className="small text-muted mb-3">{COPY.ask}</p>
      <button type="button" className="btn btn-primary btn-lg w-100 mb-2" onClick={onRegister}>{COPY.register}</button>
      <button type="button" className="btn btn-outline-secondary w-100" onClick={onBack}>
        <i className="bi bi-arrow-left me-2" aria-hidden="true" />
        {COPY.back}
      </button>
    </m.div>
  );
}
