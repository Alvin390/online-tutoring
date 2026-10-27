import { useId, useRef, useState } from 'react';
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
 * Two panes (001Fixes / 02): the classes on the left, the SELECTED class's
 * subjects on the right; stacked on a phone. One class is always selected, so
 * its subjects are on screen without first expanding anything.
 *
 * Classes: select (click, or arrow keys / Home / End on the class buttons),
 * add (button or Enter — the new class is selected, ready for its subjects),
 * rename in place, remove, move up/down, or reset everything to the defaults.
 * The order is the order of the class dropdown. The selection follows its
 * class through a move or a rename; removing the selected class selects its
 * neighbour.
 *
 * Subjects (Phase 14): rename, tick "Compulsory", move, remove, add, or go
 * back to that class's defaults. The order is the order of the checkboxes
 * students see. A class with no subjects shows students a free-text box.
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
  const [selected, setSelected] = useState(0);
  const [subjectDraft, setSubjectDraft] = useState('');
  const selectRefs = useRef([]);

  // The list can shrink from outside (Reset to defaults); never point past it.
  const current = Math.min(selected, classes.length - 1);
  const currentName = classes[current] ?? '';
  const currentLabel = currentName || `class ${current + 1}`;

  const clean = (value) => value.trim().replace(/\s+/g, ' ');
  const emit = (nextClasses, nextMap) => onChange({ classes: nextClasses, subjectsByClass: nextMap });
  const subjectsOf = (cls) => subjectsByClass[cls] ?? [];

  const select = (index) => {
    if (index !== current) {
      setSubjectDraft('');
      setHint('');
    }
    setSelected(index);
  };

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
    select(classes.length);
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
    if (index < current) setSelected(current - 1);
    else if (index === current) select(Math.min(index, classes.length - 2));
    emit(classes.filter((_, i) => i !== index), map);
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= classes.length) return;
    const next = [...classes];
    [next[index], next[target]] = [next[target], next[index]];
    if (current === index) setSelected(target);
    else if (current === target) setSelected(index);
    emit(next, subjectsByClass);
  };

  const resetAll = () => {
    select(0);
    setHint('');
    emit([...DEFAULT_CLASSES], Object.fromEntries(DEFAULT_CLASSES.map((c) => [c, subjectsForClass(null, c)])));
  };

  const handleSelectKey = (index) => (e) => {
    const target = {
      ArrowDown: Math.min(index + 1, classes.length - 1),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: classes.length - 1,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    select(target);
    selectRefs.current[target]?.focus();
  };

  // ----------------------------------------------------------------- subjects
  const subjects = subjectsOf(currentName);
  const setSubjects = (cls, list) => emit(classes, { ...subjectsByClass, [cls]: list });

  const addSubject = () => {
    const name = clean(subjectDraft);
    if (!name) return;
    if (subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setHint(`"${name}" is already a subject for ${currentName}.`);
      return;
    }
    if (subjects.length >= MAX_SUBJECTS) {
      setHint(`At most ${MAX_SUBJECTS} subjects per class.`);
      return;
    }
    setSubjects(currentName, [...subjects, { name, compulsory: false }]);
    setSubjectDraft('');
    setHint('');
  };

  const editSubject = (index, patch) =>
    setSubjects(currentName, subjects.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const moveSubject = (index, delta) => {
    const list = [...subjects];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setSubjects(currentName, list);
  };

  return (
    <fieldset className="col-12" aria-describedby={`${id}-help`}>
      <legend className="form-label small fw-semibold mb-1">
        Classes &amp; subjects <span className="text-muted fw-normal">(registration form)</span>
      </legend>
      <div id={`${id}-help`} className="form-text mt-0 mb-2">
        The class dropdown students see when registering for this session, in this order.
        Choose a class to set the subjects its students tick.
      </div>

      <div className="class-editor-grid">
        <div className="class-editor-classes">
          <div className="small fw-semibold mb-1">Classes</div>
          <ul className="list-unstyled mb-2" data-testid="class-list">
            {classes.map((name, index) => {
              const label = name || `class ${index + 1}`;
              const isSelected = index === current;
              return (
                <li key={index} className={`class-editor-row border rounded mb-1 p-1 ${isSelected ? 'is-selected' : ''}`}>
                  <div className="d-flex align-items-center gap-1">
                    <button
                      type="button"
                      ref={(el) => { selectRefs.current[index] = el; }}
                      className={`btn btn-sm text-nowrap ${isSelected ? 'btn-primary' : 'btn-light'}`}
                      onClick={() => select(index)}
                      onKeyDown={handleSelectKey(index)}
                      aria-current={isSelected ? 'true' : undefined}
                      aria-controls={`${id}-subjects`}
                      aria-label={`Show subjects for ${label}`}
                      title="Subjects"
                    >
                      <i className="bi bi-chevron-right" aria-hidden="true" />
                      <span className={`badge ms-1 ${isSelected ? 'text-bg-light' : 'text-bg-secondary'}`}>
                        {subjectsOf(name).length}
                      </span>
                    </button>
                    <input
                      className="form-control form-control-sm"
                      value={name}
                      maxLength={MAX_CLASS_NAME}
                      onChange={(e) => rename(index, e.target.value)}
                      onFocus={() => select(index)}
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
        </div>

        <section
          id={`${id}-subjects`}
          className="class-editor-subjects border rounded p-2 bg-white"
          data-testid={`subjects-${current}`}
          aria-labelledby={`${id}-subjects-heading`}
        >
          <div className="d-flex justify-content-between align-items-baseline gap-2 mb-1">
            <div id={`${id}-subjects-heading`} className="small fw-semibold" data-testid="subjects-heading">
              Subjects for {currentLabel}
            </div>
            <button
              type="button"
              className="btn btn-link btn-sm p-0 d-md-none text-nowrap"
              onClick={() => selectRefs.current[current]?.focus()}
            >
              <i className="bi bi-arrow-up-short" aria-hidden="true" />Back to classes
            </button>
          </div>
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
                  onChange={(e) => editSubject(si, { name: e.target.value })}
                  aria-label={`${currentLabel} subject ${si + 1}`}
                />
                <div className="form-check form-check-inline mb-0 me-1 text-nowrap">
                  <input
                    id={`${id}-c${current}-${si}`}
                    type="checkbox"
                    className="form-check-input"
                    checked={s.compulsory === true}
                    onChange={(e) => editSubject(si, { compulsory: e.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor={`${id}-c${current}-${si}`}>
                    Compulsory<span className="visually-hidden"> ({s.name || `subject ${si + 1}`})</span>
                  </label>
                </div>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => moveSubject(si, -1)}
                  disabled={si === 0} aria-label={`Move ${s.name || `subject ${si + 1}`} up`}>
                  <i className="bi bi-arrow-up" aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => moveSubject(si, 1)}
                  disabled={si === subjects.length - 1} aria-label={`Move ${s.name || `subject ${si + 1}`} down`}>
                  <i className="bi bi-arrow-down" aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-sm btn-outline-danger"
                  onClick={() => setSubjects(currentName, subjects.filter((_, i) => i !== si))}
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
                  addSubject();
                }
              }}
              aria-label={`New subject for ${currentLabel}`}
            />
            <button type="button" className="btn btn-outline-primary" onClick={addSubject}
              disabled={!subjectDraft.trim()}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add subject
            </button>
          </div>
          {DEFAULT_SUBJECTS_BY_CLASS[currentName] && (
            <button type="button" className="btn btn-link btn-sm px-0"
              onClick={() => setSubjects(currentName, subjectsForClass(null, currentName))}>
              Use the default subjects for {currentName}
            </button>
          )}
        </section>
      </div>

      {hint && <div className="text-danger small" role="alert">{hint}</div>}
      {error && error !== hint && <div className="text-danger small" role="alert">{error}</div>}
    </fieldset>
  );
}
