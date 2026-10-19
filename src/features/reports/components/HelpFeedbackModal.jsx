import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Modal from '@components/ui/Modal';
import { listMyReports, submitReport } from '@services/api/reports';
import { useAuthState } from '@features/auth/context/AuthContext';
import ScreenshotPicker from './ScreenshotPicker';
import {
  DISCLAIMERS, SEVERITIES, STATUS_LABELS, STATUS_TONE, URGENCIES, formatDueDate,
} from '../constants';
import { clearDraft, emptyDraft, loadDraft, saveDraft } from '../utils/reportDraft';
import '../reports.css';

/**
 * "Help & feedback" — Phase 13 / 06 D6.
 *
 * Two tabs, Report a problem and Suggest a feature, each with its own
 * disclaimer. The draft (text, report id, uploaded screenshots) survives
 * closing the modal; it is cleared only once the report is sent.
 *
 * Lazy-loaded by HelpFeedbackButton, so none of this is in the dashboard's
 * first paint.
 */

const TABS = [
  { id: 'bug', label: 'Report a problem', icon: 'bi-bug' },
  { id: 'feature', label: 'Suggest a feature', icon: 'bi-lightbulb' },
];

function collectContext(tier) {
  return {
    page: `${window.location.pathname}${window.location.search}`.slice(0, 300),
    userAgent: navigator.userAgent.slice(0, 400),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    appVersion: (import.meta.env.VITE_APP_VERSION ?? '').slice(0, 40) || undefined,
    tier,
  };
}

function validate(tab, fields) {
  const errors = {};
  if (fields.title.trim().length < 3) errors.title = 'Give it a short title (at least 3 characters).';
  if (fields.description.trim().length < 10) {
    errors.description = tab === 'bug'
      ? 'Tell us what happened (at least 10 characters).'
      : 'Describe what you would like to do (at least 10 characters).';
  }
  if (tab === 'bug' && !fields.severity) errors.severity = 'How much is this getting in your way?';
  if (tab === 'feature' && !fields.urgency) errors.urgency = 'How soon would it help?';
  return errors;
}

function Field({ id, label, hint, error, optional, children }) {
  return (
    <div className="mb-3">
      <label className="form-label fw-semibold" htmlFor={id}>
        {label}
        {optional && <span className="text-muted fw-normal small ms-1">(optional)</span>}
      </label>
      {children}
      {hint && <div id={`${id}-hint`} className="form-text">{hint}</div>}
      {error && <div id={`${id}-error`} className="invalid-feedback d-block">{error}</div>}
    </div>
  );
}

const describedBy = (id, { hint, error }) =>
  [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

export default function HelpFeedbackModal({ onClose }) {
  const { tier, user } = useAuthState();
  const uid = useId();
  const [draft, setDraft] = useState(loadDraft);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(null);
  const [mine, setMine] = useState(null);
  const inFlight = useRef(false);

  const tab = draft.tab;
  const fields = draft[tab];

  // Persist on every change; only finished screenshots are worth keeping.
  useEffect(() => {
    if (success) return;
    saveDraft({ ...draft, screenshots: draft.screenshots.filter((s) => s.status === 'done') });
  }, [draft, success]);

  const refreshMine = useCallback(() => {
    listMyReports()
      .then((res) => setMine(res?.reports ?? []))
      .catch(() => setMine([]));
  }, []);

  useEffect(() => { refreshMine(); }, [refreshMine]);

  const setField = (name, value) => {
    setDraft((d) => ({ ...d, [tab]: { ...d[tab], [name]: value } }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };

  const setScreenshots = useCallback((screenshots) => setDraft((d) => ({ ...d, screenshots })), []);

  const uploading = draft.screenshots.some((s) => s.status === 'working');
  const ready = draft.screenshots.filter((s) => s.status === 'done');

  const handleSubmit = async () => {
    if (inFlight.current) return;
    const found = validate(tab, fields);
    setErrors(found);
    setSubmitError('');
    if (Object.keys(found).length > 0) return;
    if (uploading) {
      setSubmitError('Waiting for screenshots to finish uploading…');
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    const context = collectContext(tier);
    const common = {
      type: tab,
      reportId: draft.reportId,
      title: fields.title.trim(),
      description: fields.description.trim(),
      context: { page: context.page, userAgent: context.userAgent, viewport: context.viewport, ...(context.appVersion ? { appVersion: context.appVersion } : {}) },
      attachments: ready.map((s) => ({ index: s.index })),
    };
    const body = tab === 'bug'
      ? { ...common, severity: fields.severity,
        ...(fields.steps.trim() ? { steps: fields.steps.trim() } : {}),
        ...(fields.expected.trim() ? { expected: fields.expected.trim() } : {}) }
      : { ...common, urgency: fields.urgency, ...(fields.problem.trim() ? { problem: fields.problem.trim() } : {}) };

    try {
      const res = await submitReport(body);
      clearDraft();
      setSuccess({ number: res.number, responseDueAt: res.responseDueAt, type: tab });
      setDraft(emptyDraft());
      refreshMine();
    } catch (err) {
      setSubmitError(err?.message ?? 'Sending failed. Your report is still here — please try again.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const footer = success ? (
    <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
  ) : (
    <>
      <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={submitting}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleSubmit}
        disabled={submitting || uploading}
        data-testid="report-submit"
      >
        {submitting && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
        {tab === 'bug' ? 'Send report' : 'Send suggestion'}
      </button>
    </>
  );

  const context = collectContext(tier);

  return (
    <Modal title="Help & feedback" onClose={onClose} footer={footer} wide>
      {success ? (
        <div className="text-center py-3" role="status" aria-live="polite">
          <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '2.5rem' }} aria-hidden="true" />
          <p className="fs-5 fw-semibold mt-2 mb-1" data-testid="report-success">
            Thanks! {success.number} is with us — expect a reply by {formatDueDate(success.responseDueAt)}.
          </p>
          <p className="text-muted small mb-0">We will reply to {user?.email ?? 'your email address'}.</p>
          <button type="button" className="btn btn-link btn-sm mt-2" onClick={() => setSuccess(null)}>
            Send another
          </button>
        </div>
      ) : (
        <>
          <ul className="nav nav-pills mb-3" role="tablist">
            {TABS.map((t) => (
              <li className="nav-item" role="presentation" key={t.id}>
                <button
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`${uid}-panel`}
                  className={`nav-link${tab === t.id ? ' active' : ''}`}
                  onClick={() => { setDraft((d) => ({ ...d, tab: t.id })); setErrors({}); setSubmitError(''); }}
                >
                  <i className={`bi ${t.icon} me-1`} aria-hidden="true" />
                  {t.label}
                </button>
              </li>
            ))}
          </ul>

          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
            <div className="alert alert-light border small" data-testid="report-disclaimer">
              <i className={`bi ${tab === 'bug' ? 'bi-heart' : 'bi-stars'} me-2 text-primary`} aria-hidden="true" />
              {DISCLAIMERS[tab]}
            </div>

            <Field id={`${uid}-title`} label="Title" error={errors.title}>
              <input
                id={`${uid}-title`}
                className={`form-control${errors.title ? ' is-invalid' : ''}`}
                value={fields.title}
                maxLength={140}
                onChange={(e) => setField('title', e.target.value)}
                placeholder={tab === 'bug' ? 'e.g. Students cannot join the evening class' : 'e.g. Export attendance to Excel'}
                aria-describedby={describedBy(`${uid}-title`, { error: errors.title })}
                aria-invalid={Boolean(errors.title)}
              />
            </Field>

            <Field
              id={`${uid}-description`}
              label={tab === 'bug' ? 'What happened?' : 'What would you like to be able to do?'}
              error={errors.description}
            >
              <textarea
                id={`${uid}-description`}
                className={`form-control${errors.description ? ' is-invalid' : ''}`}
                rows={4}
                maxLength={5000}
                value={fields.description}
                onChange={(e) => setField('description', e.target.value)}
                aria-describedby={describedBy(`${uid}-description`, { error: errors.description })}
                aria-invalid={Boolean(errors.description)}
              />
            </Field>

            {tab === 'bug' ? (
              <>
                <Field id={`${uid}-steps`} label="Steps to reproduce" optional>
                  <textarea id={`${uid}-steps`} className="form-control" rows={3} maxLength={5000}
                    value={fields.steps} onChange={(e) => setField('steps', e.target.value)}
                    placeholder={'1. Open …\n2. Tap …'} />
                </Field>
                <Field id={`${uid}-expected`} label="What did you expect?" optional>
                  <textarea id={`${uid}-expected`} className="form-control" rows={2} maxLength={2000}
                    value={fields.expected} onChange={(e) => setField('expected', e.target.value)} />
                </Field>
                <fieldset className="mb-3" aria-describedby={errors.severity ? `${uid}-severity-error` : undefined}>
                  <legend className="form-label fw-semibold fs-6">How much is it getting in your way?</legend>
                  <div className="report-choice-grid">
                    {SEVERITIES.map((s) => (
                      <label key={s.id} className={`report-choice${fields.severity === s.id ? ' is-selected' : ''}`}>
                        <input type="radio" name={`${uid}-severity`} value={s.id} className="visually-hidden"
                          checked={fields.severity === s.id} onChange={() => setField('severity', s.id)} />
                        <i className={`bi ${s.icon} fs-4`} aria-hidden="true" />
                        <span className="fw-semibold">{s.label}</span>
                        <span className="small text-muted">{s.hint}</span>
                      </label>
                    ))}
                  </div>
                  {errors.severity && <div id={`${uid}-severity-error`} className="invalid-feedback d-block">{errors.severity}</div>}
                </fieldset>
              </>
            ) : (
              <>
                <Field id={`${uid}-problem`} label="What problem would it solve?" optional>
                  <textarea id={`${uid}-problem`} className="form-control" rows={3} maxLength={3000}
                    value={fields.problem} onChange={(e) => setField('problem', e.target.value)} />
                </Field>
                <fieldset className="mb-3" aria-describedby={errors.urgency ? `${uid}-urgency-error` : undefined}>
                  <legend className="form-label fw-semibold fs-6">How soon would it help?</legend>
                  {URGENCIES.map((u) => (
                    <div className="form-check" key={u.id}>
                      <input className="form-check-input" type="radio" id={`${uid}-urgency-${u.id}`} name={`${uid}-urgency`}
                        checked={fields.urgency === u.id} onChange={() => setField('urgency', u.id)} />
                      <label className="form-check-label" htmlFor={`${uid}-urgency-${u.id}`}>{u.label}</label>
                    </div>
                  ))}
                  {errors.urgency && <div id={`${uid}-urgency-error`} className="invalid-feedback d-block">{errors.urgency}</div>}
                </fieldset>
              </>
            )}

            <div className="mb-3">
              <span className="form-label fw-semibold d-block">
                {tab === 'bug' ? 'Screenshots' : 'Screenshots or mock-ups'}
                <span className="text-muted fw-normal small ms-1">(optional)</span>
              </span>
              <ScreenshotPicker
                reportId={draft.reportId}
                screenshots={draft.screenshots}
                onChange={setScreenshots}
                disabled={submitting}
              />
            </div>

            <details className="small mb-2">
              <summary>We&apos;ll include automatically</summary>
              <ul className="mb-0 mt-1 text-muted">
                <li>Page: {context.page}</li>
                <li>Browser: {context.userAgent}</li>
                <li>Screen: {context.viewport}</li>
                {context.appVersion && <li>App version: {context.appVersion}</li>}
                <li>Your plan: {tier ?? '—'}</li>
              </ul>
            </details>

            {submitError && <div className="alert alert-danger py-2 small mb-0" role="alert">{submitError}</div>}
          </div>
        </>
      )}

      <hr />
      <h3 className="h6 fw-semibold">Your reports</h3>
      {mine === null ? (
        <div className="small text-muted">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="small text-muted">Nothing sent yet.</div>
      ) : (
        <ul className="list-unstyled small mb-0" data-testid="my-reports">
          {mine.slice(0, 5).map((r) => (
            <li key={r.id} className="d-flex align-items-center gap-2 py-1 border-bottom">
              <span className="fw-semibold text-nowrap">{r.number}</span>
              <span className="text-truncate flex-grow-1">{r.title}</span>
              <span className={`badge text-bg-${STATUS_TONE[r.status] ?? 'secondary'}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
              <span className="text-muted text-nowrap">{r.createdAt ? formatDueDate(r.createdAt) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
