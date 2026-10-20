import { useId, useState } from 'react';
import { DEFAULT_CLASSES, MAX_CLASSES, MAX_CLASS_NAME } from '@shared/constants/sessions';

/**
 * The classes students can choose when registering for this session.
 *
 * Add (button or Enter), rename in place, remove, move up/down, or reset to
 * the defaults. The order here is the order of the registration dropdown.
 * Validation (blank, duplicate, limits) is reported by the parent form via
 * `error`, the same way the other session fields are.
 */
export default function ClassListEditor({ classes, onChange, error = '' }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');

  const clean = (value) => value.trim().replace(/\s+/g, ' ');

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
    onChange([...classes, name]);
    setDraft('');
    setHint('');
  };

  const rename = (index, value) => onChange(classes.map((c, i) => (i === index ? value : c)));
  const remove = (index) => onChange(classes.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= classes.length) return;
    const next = [...classes];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <fieldset className="col-12" aria-describedby={`${id}-help`}>
      <legend className="form-label small fw-semibold mb-1">
        Classes students can choose <span className="text-muted fw-normal">(registration form)</span>
      </legend>
      <div id={`${id}-help`} className="form-text mt-0 mb-2">
        The class dropdown students see when registering for this session, in this order.
      </div>

      <ul className="list-unstyled mb-2" data-testid="class-list">
        {classes.map((name, index) => (
          <li key={index} className="d-flex align-items-center gap-1 mb-1">
            <input
              className="form-control form-control-sm"
              value={name}
              maxLength={MAX_CLASS_NAME}
              onChange={(e) => rename(index, e.target.value)}
              aria-label={`Class ${index + 1}`}
            />
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, -1)}
              disabled={index === 0} aria-label={`Move ${name || `class ${index + 1}`} up`}>
              <i className="bi bi-arrow-up" aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => move(index, 1)}
              disabled={index === classes.length - 1} aria-label={`Move ${name || `class ${index + 1}`} down`}>
              <i className="bi bi-arrow-down" aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(index)}
              disabled={classes.length <= 1} aria-label={`Remove ${name || `class ${index + 1}`}`}>
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="input-group input-group-sm">
        <input
          className="form-control"
          placeholder="Add a class, e.g. Grade 7"
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
      <button type="button" className="btn btn-link btn-sm px-0" onClick={() => { onChange([...DEFAULT_CLASSES]); setHint(''); }}>
        Reset to defaults ({DEFAULT_CLASSES.join(', ')})
      </button>

      {(hint || error) && (
        <div className="text-danger small" role="alert">{hint || error}</div>
      )}
    </fieldset>
  );
}
