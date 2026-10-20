import { useId } from 'react';

/**
 * Subject checkboxes for one class — Phase 14.
 *
 * `options` are the class's subjects ({ name, compulsory }); `value` is the
 * list of chosen names. A chosen name that is not one of the options (a
 * student registered before the list existed, or whose class the teacher has
 * just changed) is shown as an extra, already-ticked box so nothing is lost
 * silently; unticking it removes it.
 *
 * `lockCompulsory` (students) keeps compulsory subjects ticked and disabled.
 * The teacher's edit form leaves it off: the badge still shows, but the
 * teacher may record an exception.
 *
 * `onChange` receives the names in the list's order, extras after.
 */
export default function SubjectPicker({
  options,
  value,
  onChange,
  lockCompulsory = true,
  invalid = false,
  describedBy,
  legend = 'Subjects',
}) {
  const id = useId();
  const has = (name) => value.some((v) => v.toLowerCase() === name.toLowerCase());
  const extras = value.filter((v) => !options.some((o) => o.name.toLowerCase() === v.toLowerCase()));

  const toggle = (name) => {
    const next = has(name)
      ? value.filter((v) => v.toLowerCase() !== name.toLowerCase())
      : [...value, name];
    const inList = options.filter((o) => next.some((v) => v.toLowerCase() === o.name.toLowerCase())).map((o) => o.name);
    const rest = next.filter((v) => !options.some((o) => o.name.toLowerCase() === v.toLowerCase()));
    onChange([...inList, ...rest]);
  };

  return (
    <fieldset
      className={`subject-picker border rounded p-2 ${invalid ? 'border-danger' : ''}`}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      data-testid="subject-picker"
    >
      <legend className="visually-hidden">{legend}</legend>
      <div className="row g-1">
        {options.map((o, i) => {
          const locked = lockCompulsory && o.compulsory;
          return (
            <div key={o.name} className="col-12 col-sm-6">
              <div className="form-check mb-0">
                <input
                  id={`${id}-${i}`}
                  type="checkbox"
                  className="form-check-input"
                  checked={locked || has(o.name)}
                  disabled={locked}
                  onChange={() => toggle(o.name)}
                />
                <label className="form-check-label" htmlFor={`${id}-${i}`}>
                  {o.name}
                  {o.compulsory && <span className="badge text-bg-light border ms-1 fw-normal">Compulsory</span>}
                </label>
              </div>
            </div>
          );
        })}
        {extras.map((name, i) => (
          <div key={`extra-${name}`} className="col-12 col-sm-6">
            <div className="form-check mb-0">
              <input
                id={`${id}-x${i}`}
                type="checkbox"
                className="form-check-input"
                checked
                onChange={() => toggle(name)}
              />
              <label className="form-check-label" htmlFor={`${id}-x${i}`}>
                {name} <span className="text-muted small">(not on this class&apos;s list)</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** The starting choice for a class: its compulsory subjects. */
export const compulsoryNames = (options) => options.filter((o) => o.compulsory).map((o) => o.name);
