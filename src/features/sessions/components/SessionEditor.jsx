import { useMemo, useRef, useState } from 'react';
import SessionCard from './SessionCard';
import ClassListEditor from './ClassListEditor';
import {
  validateSlug,
  slugify,
  SESSION_ICONS,
  SESSION_GRADIENTS,
  MAX_SESSION_NAME,
  MAX_SESSION_DESCRIPTION,
  SESSION_TZ,
  DEFAULT_CLASSES,
  MAX_CLASSES,
} from '@shared/constants/sessions';
import { MAX_SUBJECTS, resolveSubjectsByClass } from '@shared/constants/subjects';

/**
 * Create / edit a session — Phase 13 / 02 D8.
 *
 * ONE form for both, and for every session alike: morning and evening are
 * ordinary sessions that happen to be created first, so they get exactly this
 * panel. Every field the homepage card shows is here, and the card itself is
 * rendered live beside the form (SessionCard `preview`), so the teacher sees
 * what students will see before saving.
 *
 * The registration link (slug) is editable only when CREATING. Afterwards it
 * is shown read-only with a copy button: it is the document ID and the link
 * already handed to parents, so renaming "Morning Session" keeps /morning.
 *
 * On save, an edit sends ONLY the fields that changed.
 *
 * Two tabs (001Fixes / 01): "Details" (everything the homepage card shows) and
 * "Classes & subjects" (the registration form's class dropdown and subject
 * checkboxes). It is still ONE form with one Save — both panels stay mounted
 * and are only hidden, so nothing typed on one tab is lost by visiting the
 * other, and the payload is exactly what it was before the tabs existed. A
 * Save that finds an error on the tab the teacher is not looking at opens that
 * tab, so the message is never invisible.
 */

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const VIEWS = ['details', 'classes'];

/** Which tab each validation error belongs to. */
const DETAILS_ERRORS = ['name', 'slug', 'description', 'time'];
const tabsWithErrors = (errors) => [
  ...(DETAILS_ERRORS.some((key) => errors[key]) ? ['details'] : []),
  ...(errors.classes ? ['classes'] : []),
];

const sameSchedule = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cleanClass = (c) => c.trim().replace(/\s+/g, ' ');
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The subjects map as saved: tidied names, keyed by the tidied class names, in class order. */
function cleanSubjectsMap(form) {
  return Object.fromEntries(form.classes.map((c) => [
    cleanClass(c),
    (form.subjectsByClass[c] ?? []).map((s) => ({ name: cleanClass(s.name), compulsory: s.compulsory === true })),
  ]));
}

function toForm(session) {
  const classes = Array.isArray(session?.classes) && session.classes.length > 0
    ? [...session.classes]
    : [...DEFAULT_CLASSES];
  return {
    name: session?.name ?? '',
    slug: session?.id ?? session?.slug ?? '',
    description: session?.description ?? '',
    days: [...(session?.schedule?.days ?? [])],
    startTime: session?.schedule?.startTime ?? '',
    endTime: session?.schedule?.endTime ?? '',
    icon: session?.icon ?? SESSION_ICONS[0],
    gradient: session?.gradient ?? SESSION_GRADIENTS[0],
    active: session?.active !== false,
    // The session's own list, or the defaults it has been offering until now.
    classes,
    // Phase 14: each class's subjects — saved ones, else the defaults by name.
    subjectsByClass: resolveSubjectsByClass(session, classes),
  };
}

/** Form → the schedule object the API takes (or null when no times are set). */
function scheduleFrom(form) {
  if (!form.startTime && !form.endTime) return null;
  return {
    days: [...form.days].sort((a, b) => a - b),
    startTime: form.startTime,
    endTime: form.endTime,
    tz: SESSION_TZ,
  };
}

export function validateSessionForm(form, { creating }) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Give the session a name.';
  if (creating) {
    const check = validateSlug(form.slug);
    if (!check.valid) errors.slug = check.error;
  }
  if (form.description.length > MAX_SESSION_DESCRIPTION) {
    errors.description = `Keep it under ${MAX_SESSION_DESCRIPTION} characters.`;
  }
  if (Boolean(form.startTime) !== Boolean(form.endTime)) {
    errors.time = 'Set both a start and an end time, or neither.';
  } else if (form.startTime && form.endTime <= form.startTime) {
    errors.time = 'The end time must be after the start time.';
  }
  const classes = form.classes.map(cleanClass);
  if (classes.length === 0) errors.classes = 'Keep at least one class.';
  else if (classes.some((c) => !c)) errors.classes = 'A class name cannot be blank — remove it or give it a name.';
  else if (new Set(classes.map((c) => c.toLowerCase())).size !== classes.length) errors.classes = 'Each class may appear only once.';
  else if (classes.length > MAX_CLASSES) errors.classes = `At most ${MAX_CLASSES} classes.`;
  if (!errors.classes) {
    for (const [cls, list] of Object.entries(cleanSubjectsMap(form))) {
      const names = list.map((s) => s.name);
      if (names.some((n) => !n)) errors.classes = `A subject name in ${cls} is blank — remove it or give it a name.`;
      else if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.classes = `Each subject may appear only once in ${cls}.`;
      else if (names.length > MAX_SUBJECTS) errors.classes = `At most ${MAX_SUBJECTS} subjects in ${cls}.`;
      if (errors.classes) break;
    }
  }
  return errors;
}

export default function SessionEditor({
  session = null,
  onSave,
  onCancel,
  busy = false,
  serverError = '',
  initialView = 'details',
}) {
  const creating = !session;
  const initial = useMemo(() => toForm(session), [session]);
  const [form, setForm] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState(VIEWS.includes(initialView) ? initialView : 'details');
  const tabRefs = useRef({});

  const errors = validateSessionForm(form, { creating });
  const showErrors = submitted;
  const errorTabs = showErrors ? tabsWithErrors(errors) : [];
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const prefix = creating ? 'new-session' : `edit-${session.id}`;

  const focusTab = (next) => {
    setView(next);
    tabRefs.current[next]?.focus();
  };

  const handleTabKey = (e) => {
    const index = VIEWS.indexOf(view);
    const target = {
      ArrowRight: VIEWS[(index + 1) % VIEWS.length],
      ArrowLeft: VIEWS[(index - 1 + VIEWS.length) % VIEWS.length],
      Home: VIEWS[0],
      End: VIEWS[VIEWS.length - 1],
    }[e.key];
    if (!target) return;
    e.preventDefault();
    focusTab(target);
  };

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleName = (name) =>
    set({ name, ...(creating && !slugTouched ? { slug: slugify(name) } : {}) });

  const toggleDay = (value) =>
    set({ days: form.days.includes(value) ? form.days.filter((d) => d !== value) : [...form.days, value] });

  const preview = {
    id: form.slug || 'preview',
    name: form.name,
    description: form.description,
    schedule: scheduleFrom(form),
    icon: form.icon,
    gradient: form.gradient,
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      // Open the tab holding the first error — unless the open tab has one of
      // its own, which is already on screen.
      const withErrors = tabsWithErrors(errors);
      if (!withErrors.includes(view)) setView(withErrors[0]);
      return;
    }

    const schedule = scheduleFrom(form);

    if (creating) {
      const check = validateSlug(form.slug);
      await onSave({
        slug: check.slug,
        name: form.name.trim(),
        description: form.description.trim(),
        schedule,
        icon: form.icon,
        gradient: form.gradient,
        active: form.active,
        classes: form.classes.map(cleanClass),
        subjectsByClass: cleanSubjectsMap(form),
      });
      return;
    }

    // Edit: only what changed.
    const patch = {};
    if (form.name.trim() !== initial.name) patch.name = form.name.trim();
    if (form.description.trim() !== initial.description) patch.description = form.description.trim();
    if (!sameSchedule(schedule, scheduleFrom(initial))) patch.schedule = schedule;
    if (form.icon !== initial.icon) patch.icon = form.icon;
    if (form.gradient !== initial.gradient) patch.gradient = form.gradient;
    if (form.active !== initial.active) patch.active = form.active;
    const classes = form.classes.map(cleanClass);
    if (!sameList(classes, initial.classes)) patch.classes = classes;
    const subjectsByClass = cleanSubjectsMap(form);
    if (!sameList(subjectsByClass, cleanSubjectsMap(initial))) patch.subjectsByClass = subjectsByClass;

    if (Object.keys(patch).length === 0) {
      onCancel?.();
      return;
    }
    await onSave(patch);
  };

  const copyLink = () => navigator.clipboard?.writeText(`${window.location.origin}/${form.slug}`);

  return (
    <form className="border rounded p-3 mb-3 bg-light" onSubmit={handleSubmit} noValidate aria-label={creating ? 'New session' : `Edit ${session.name}`}>
      <div className="session-editor-tabs d-flex flex-wrap align-items-end gap-2 mb-3">
        <ul className="nav nav-tabs flex-nowrap flex-grow-1" role="tablist" aria-label="Session settings">
          {VIEWS.map((id) => {
            const selected = view === id;
            return (
              <li className="nav-item" role="presentation" key={id}>
                <button
                  type="button"
                  role="tab"
                  id={`${prefix}-tab-${id}`}
                  ref={(el) => { tabRefs.current[id] = el; }}
                  aria-selected={selected}
                  aria-controls={`${prefix}-panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  className={`nav-link text-nowrap ${selected ? 'active' : ''}`}
                  onClick={() => setView(id)}
                  onKeyDown={handleTabKey}
                >
                  {id === 'details' ? (
                    <><i className="bi bi-card-text me-1" aria-hidden="true" />Details</>
                  ) : (
                    <>
                      <i className="bi bi-journal-bookmark me-1" aria-hidden="true" />Classes &amp; subjects
                      <span className="badge rounded-pill text-bg-secondary ms-1" data-testid="class-count">{form.classes.length}</span>
                      <span className="visually-hidden"> classes</span>
                    </>
                  )}
                  {errorTabs.includes(id) && (
                    <span className="session-tab-error ms-1" data-testid="tab-error">
                      <span className="visually-hidden">(needs attention)</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {dirty && (
          <span className="badge rounded-pill text-bg-warning mb-1" data-testid="unsaved-pill">
            <i className="bi bi-dot" aria-hidden="true" />Unsaved changes
          </span>
        )}
      </div>

      <div
        id={`${prefix}-panel-details`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-details`}
        hidden={view !== 'details'}
      >
        <div className="row g-4">
          <div className="col-lg-7">
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor={`${prefix}-name`}>Session name</label>
                <input
                  id={`${prefix}-name`}
                  className={`form-control ${showErrors && errors.name ? 'is-invalid' : ''}`}
                  placeholder="e.g. Saturday Revision"
                  value={form.name}
                  onChange={(e) => handleName(e.target.value)}
                  maxLength={MAX_SESSION_NAME}
                  aria-describedby={showErrors && errors.name ? `${prefix}-name-error` : undefined}
                />
                {showErrors && errors.name && (
                  <div id={`${prefix}-name-error`} className="invalid-feedback d-block">{errors.name}</div>
                )}
              </div>

              <div className="col-md-6">
                <label className="form-label small fw-semibold" htmlFor={`${prefix}-slug`}>Registration link</label>
                <div className="input-group">
                  <span className="input-group-text small">/</span>
                  <input
                    id={`${prefix}-slug`}
                    className={`form-control ${showErrors && errors.slug ? 'is-invalid' : ''}`}
                    value={form.slug}
                    readOnly={!creating}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set({ slug: e.target.value });
                    }}
                    maxLength={40}
                    aria-describedby={`${prefix}-slug-help`}
                  />
                  {!creating && (
                    <button type="button" className="btn btn-outline-secondary" onClick={copyLink} aria-label="Copy registration link">
                      <i className="bi bi-clipboard" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div id={`${prefix}-slug-help`} className={showErrors && errors.slug ? 'text-danger small mt-1' : 'form-text'} role={showErrors && errors.slug ? 'alert' : undefined}>
                  {showErrors && errors.slug
                    ? errors.slug
                    : creating
                      ? 'This becomes the link you share. It cannot be changed later.'
                      : 'Fixed, so links you have already shared keep working.'}
                </div>
              </div>

              <div className="col-12">
                <label className="form-label small fw-semibold" htmlFor={`${prefix}-description`}>
                  Description <span className="text-muted fw-normal">(shown on the homepage)</span>
                </label>
                <textarea
                  id={`${prefix}-description`}
                  className={`form-control ${showErrors && errors.description ? 'is-invalid' : ''}`}
                  rows={2}
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  maxLength={MAX_SESSION_DESCRIPTION}
                  aria-describedby={`${prefix}-description-count`}
                />
                <div id={`${prefix}-description-count`} className="form-text text-end">
                  {form.description.length}/{MAX_SESSION_DESCRIPTION}
                </div>
              </div>

              <fieldset className="col-12">
                <legend className="form-label small fw-semibold mb-2">Days</legend>
                <div className="d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn btn-sm ${form.days.length === 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                    aria-pressed={form.days.length === 0}
                    onClick={() => set({ days: [] })}
                  >
                    Every day
                  </button>
                  {DAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={`btn btn-sm ${form.days.includes(d.value) ? 'btn-primary' : 'btn-outline-secondary'}`}
                      aria-pressed={form.days.includes(d.value)}
                      onClick={() => toggleDay(d.value)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="col-6">
                <label className="form-label small fw-semibold" htmlFor={`${prefix}-start`}>Start time</label>
                <input
                  id={`${prefix}-start`}
                  type="time"
                  className={`form-control ${showErrors && errors.time ? 'is-invalid' : ''}`}
                  value={form.startTime}
                  onChange={(e) => set({ startTime: e.target.value })}
                />
              </div>
              <div className="col-6">
                <label className="form-label small fw-semibold" htmlFor={`${prefix}-end`}>End time</label>
                <input
                  id={`${prefix}-end`}
                  type="time"
                  className={`form-control ${showErrors && errors.time ? 'is-invalid' : ''}`}
                  value={form.endTime}
                  onChange={(e) => set({ endTime: e.target.value })}
                  aria-describedby={showErrors && errors.time ? `${prefix}-time-error` : undefined}
                />
              </div>
              {showErrors && errors.time && (
                <div id={`${prefix}-time-error`} className="col-12 text-danger small" role="alert">{errors.time}</div>
              )}

              <div className="col-md-6">
                <span className="form-label small fw-semibold d-block" id={`${prefix}-icon-label`}>Icon</span>
                <div className="d-flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${prefix}-icon-label`}>
                  {SESSION_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      role="radio"
                      aria-checked={form.icon === icon}
                      aria-label={icon.replace('bi-', '').replace(/-/g, ' ')}
                      className={`btn ${form.icon === icon ? 'btn-primary' : 'btn-outline-secondary'} d-flex align-items-center justify-content-center`}
                      style={{ width: 44, height: 44 }}
                      onClick={() => set({ icon })}
                    >
                      <i className={`bi ${icon} fs-5`} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-md-6">
                <span className="form-label small fw-semibold d-block" id={`${prefix}-colour-label`}>Colour</span>
                <div className="d-flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${prefix}-colour-label`}>
                  {SESSION_GRADIENTS.map((g, i) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={form.gradient === g}
                      aria-label={`Colour theme ${i + 1}`}
                      className="btn p-0 position-relative"
                      style={{
                        width: 44,
                        height: 44,
                        background: g,
                        borderRadius: '0.375rem',
                        border: `2px solid ${form.gradient === g ? 'var(--bs-primary, #0d6efd)' : 'transparent'}`,
                      }}
                      onClick={() => set({ gradient: g })}
                    >
                      {form.gradient === g && (
                        <i className="bi bi-check-lg position-absolute top-50 start-50 translate-middle text-white fs-5" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-12">
                <div className="form-check form-switch">
                  <input
                    id={`${prefix}-active`}
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    checked={form.active}
                    onChange={(e) => set({ active: e.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor={`${prefix}-active`}>
                    Shown on homepage {form.active ? '' : '(hidden — students cannot register)'}
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="col-lg-5">
            <div className="small fw-semibold mb-2">Preview — what students see</div>
            <div className="p-3 rounded" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }}>
              <SessionCard session={preview} preview />
            </div>
          </div>
        </div>
      </div>

      <div
        id={`${prefix}-panel-classes`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-classes`}
        hidden={view !== 'classes'}
      >
        <div className="row">
          <ClassListEditor
            classes={form.classes}
            subjectsByClass={form.subjectsByClass}
            onChange={({ classes, subjectsByClass }) => set({ classes, subjectsByClass })}
            error={showErrors ? errors.classes : ''}
          />
        </div>
      </div>

      {serverError && <div className="alert alert-danger mt-3 mb-0 py-2 small" role="alert">{serverError}</div>}

      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {creating ? 'Create session' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
