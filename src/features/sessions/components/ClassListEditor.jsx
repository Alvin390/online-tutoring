import { useId, useState } from 'react';
import { DEFAULT_CLASSES, MAX_CLASSES, MAX_CLASS_NAME } from '@shared/constants/sessions';
import {
  DEFAULT_SUBJECTS_BY_CLASS,
  MAX_SUBJECTS,
  MAX_SUBJECT_NAME,
  subjectsForClass,
} from '@shared/constants/subjects';

/**
 * Classes and their subjects for this session's registration form.
 *
 * Classes: add (button or Enter), rename in place, remove, move up/down, or
 * reset everything to the defaults. The order is the order of the class
 * dropdown.
 *
 * Subjects (Phase 14): each class opens to its own list — rename, tick
 * "Compulsory", move, remove, add, or go back to that class's defaults. The
 * order is the order of the checkboxes students see. A class with no subjects
 * shows students a free-text box instead.
 *
 * Renaming a class carries its subjects with it. Validation (blank,
 * duplicate, limits) is reported by the parent form via `error`.
 *
 * onChange receives `{ classes, subjectsByClass }`.
 */
export default function ClassListEditor({ classes, subjectsByClass, onChange, error = '' }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  const [open, setOpen] = useState(null);
  const [subjectDraft, setSubjectDraft] = useState('');

  const clean = (value) => value.trim().replace(/\s+/g, ' ');
  const emit = (nextClasses, nextMap) => onChange({ classes: nextClasses, subjectsByClass: nextMap });
  const subjectsOf = (cls) => subjectsByClass[cls] ?? [];

  // ------------------------------------------------------------------ classes
  const add = () => {
    const name = clean(draft);
    if (!name) return;
    if (classes.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setHint(`"${name}" is already in the list.`);
      return;
    }
    if (classes.length >= MAX_CLASSES) {
      setHint(`At most ${MAX_CLASSES} classes.`);
      return;
    }
    // A class with a known name starts with its default subjects.
    emit([...classes, name], { ...subjectsByClass, [name]: subjectsForClass(null, name) });
    setDraft('');
    setHint('');
  };

  const rename = (index, value) => {
    const old = classes[index];
    const map = Object.fromEntries(Object.entries(subjectsByClass).map(([k, v]) => [k === old ? value : k, v]));
    emit(classes.map((c, i) => (i === index ? value : c)), map);
  };

  const remove = (index) => {
    const gone = classes[index];
    const map = { ...subjectsByClass };
    delete map[gone];
    if (open === index) setOpen(null);
    emit(classes.filter((_, i) => i !== index), map);
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= classes.length) return;
    const next = [...classes];
    [next[index], next[target]] = [next[target], next[index]];
    if (open === index) setOpen(target);
    else if (open === target) setOpen(index);
    emit(next, subjectsByClass);
  };

  const resetAll = () => {
    setOpen(null);
    setHint('');
    emit([...DEFAULT_CLASSES], Object.fromEntries(DEFAULT_CLASSES.map((c) => [c, subjectsForClass(null, c)])));
  };

  // ----------------------------------------------------------------- subjects
  const setSubjects = (cls, list) => emit(classes, { ...subjectsByClass, [cls]: list });

  const addSubject = (cls) => {
    const name = clean(subjectDraft);
    if (!name) return;
    const list = subjectsOf(cls);
    if (list.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setHint(`"${name}" is already a subject for ${cls}.`);
      return;
    }
    if (list.length >= MAX_SUBJECTS) {
      setHint(`At most ${MAX_SUBJECTS} subjects per class.`);
      return;
    }
    setSubjects(cls, [...list, { name, compulsory: false }]);
    setSubjectDraft('');
    setHint('');
  };

  const editSubject = (cls, index, patch) =>
    setSubjects(cls, subjectsOf(cls).map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const moveSubject = (cls, index, delta) => {
    const list = [...subjectsOf(cls)];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setSubjects(cls, list);
  };

  const toggleOpen = (index) => {
    setOpen(open === index ? null : index);
    setSubjectDraft('');
    setHint('');
  };

  return (
    <fieldset className="col-12" aria-describedby={`${id}-help`}>
      <legend className="form-label small fw-semibold mb-1">
        Classes &amp; subjects <span className="text-muted fw-normal">(registration form)</span>
      </legend>
      <div id={`${id}-help`} className="form-text mt-0 mb-2">
        The class dropdown students see when registering for this session, in this order.
        Open a class to set the subjects its students tick.
      </div>

      <ul className="list-unstyled mb-2" data-testid="class-list">
        {classes.map((name, index) => {
          const subjects = subjectsOf(name);
          const label = name || `class ${index + 1}`;
          const isOpen = open === index;
          return (
            <li key={index} className="border rounded mb-1 p-1">
              <div className="d-flex align-items-center gap-1">
                <button
                  type="button"
                  className="btn btn-sm btn-light text-nowrap"
                  onClick={() => toggleOpen(index)}
                  aria-expanded={isOpen}
                  aria-controls={`${id}-subjects-${index}`}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} subjects for ${label}`}
                  title="Subjects"
                >
                  <i className={`bi bi-chevron-${isOpen ? 'down' : 'right'}`} aria-hidden="true" />
                  <span className="badge text-bg-secondary ms-1">{subjects.length}</span>
                </button>
                <input
                  className="form-control form-control-sm"
                  value={name}
                  maxLength={MAX_CLASS_NAME}
                  onChange={(e) => rename(index, e.target.value)}
                  aria-label={`Class ${index + 1}`}
                />
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, -1)}
                  disabled={index === 0} aria-label={`Move ${label} up`}>
                  <i className="bi bi-arrow-up" aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, 1)}
                  disabled={index === classes.length - 1} aria-label={`Move ${label} down`}>
                  <i className="bi bi-arrow-down" aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(index)}
                  disabled={classes.length <= 1} aria-label={`Remove ${label}`}>
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              </div>

              {isOpen && (
                <div id={`${id}-subjects-${index}`} className="ps-2 pe-1 pt-2" data-testid={`subjects-${index}`}>
                  <div className="small fw-semibold mb-1">Subjects for {label}</div>
                  {subjects.length === 0 && (
                    <div className="small text-muted mb-1">
                      No subjects: students in this class type their subjects instead.
                    </div>
                  )}
                  <ul className="list-unstyled mb-1">
                    {subjects.map((s, si) => (
                      <li key={si} className="d-flex align-items-center gap-1 mb-1 flex-wrap flex-sm-nowrap">
                        <input
                          className="form-control form-control-sm"
                          value={s.name}
                          maxLength={MAX_SUBJECT_NAME}
                          onChange={(e) => editSubject(name, si, { name: e.target.value })}
                          aria-label={`${label} subject ${si + 1}`}
                        />
                        <div className="form-check form-check-inline mb-0 me-1 text-nowrap">
                          <input
                            id={`${id}-c${index}-${si}`}
                            type="checkbox"
                            className="form-check-input"
                            checked={s.compulsory === true}
                            onChange={(e) => editSubject(name, si, { compulsory: e.target.checked })}
                          />
                          <label className="form-check-label small" htmlFor={`${id}-c${index}-${si}`}>
                            Compulsory<span className="visually-hidden"> ({s.name || `subject ${si + 1}`})</span>
                          </label>
                        </div>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => moveSubject(name, si, -1)}
                          disabled={si === 0} aria-label={`Move ${s.name || `subject ${si + 1}`} up`}>
                          <i className="bi bi-arrow-up" aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => moveSubject(name, si, 1)}
                          disabled={si === subjects.length - 1} aria-label={`Move ${s.name || `subject ${si + 1}`} down`}>
                          <i className="bi bi-arrow-down" aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-danger"
                          onClick={() => setSubjects(name, subjects.filter((_, i) => i !== si))}
                          aria-label={`Remove ${s.name || `subject ${si + 1}`}`}>
                          <i className="bi bi-x-lg" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="input-group input-group-sm mb-1">
                    <input
                      className="form-control"
                      placeholder="Add a subject, e.g. Biology"
                      value={subjectDraft}
                      maxLength={MAX_SUBJECT_NAME}
                      onChange={(e) => { setSubjectDraft(e.target.value); setHint(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSubject(name);
                        }
                      }}
                      aria-label={`New subject for ${label}`}
                    />
                    <button type="button" className="btn btn-outline-primary" onClick={() => addSubject(name)}
                      disabled={!subjectDraft.trim()}>
                      <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add subject
                    </button>
                  </div>
                  {DEFAULT_SUBJECTS_BY_CLASS[name] && (
                    <button type="button" className="btn btn-link btn-sm px-0"
                      onClick={() => setSubjects(name, subjectsForClass(null, name))}>
                      Use the default subjects for {name}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="input-group input-group-sm">
        <input
          className="form-control"
          placeholder="Add a class, e.g. Grade 9"
          value={draft}
          maxLength={MAX_CLASS_NAME}
          onChange={(e) => { setDraft(e.target.value); setHint(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-label="New class name"
        />
        <button type="button" className="btn btn-outline-primary" onClick={add} disabled={!draft.trim()}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add
        </button>
      </div>
      <button type="button" className="btn btn-link btn-sm px-0" onClick={resetAll}>
        Reset to defaults ({DEFAULT_CLASSES.join(', ')}, with their subjects)
      </button>

      {hint && <div className="text-danger small" role="alert">{hint}</div>}
      {error && error !== hint && <div className="text-danger small" role="alert">{error}</div>}
    </fieldset>
  );
}
