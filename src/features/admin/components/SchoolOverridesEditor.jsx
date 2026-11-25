import { useState } from 'react';
import { saveSchoolOverrides } from '@services/api/adminBilling';
import { FEATURE_LABELS, LIMIT_LABELS } from '../planLabels';

/**
 * This school's own limits and features, on top of its plan — 013Fixes / 22b
 * (owner suggestion 8). A limit left empty, and a feature left on "Plan's",
 * follow the plan. Saved whole: emptying a box really removes it.
 */

const FEATURE_CHOICES = [
  { id: '', label: "Plan's" },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

function toDraft(current) {
  const limits = Object.fromEntries(Object.keys(LIMIT_LABELS).map((k) => [k, current?.limits?.[k] != null ? String(current.limits[k]) : '']));
  const features = Object.fromEntries(Object.keys(FEATURE_LABELS).map((k) => {
    const v = current?.features?.[k];
    return [k, v === true ? 'on' : v === false ? 'off' : ''];
  }));
  return { limits, features };
}

export default function SchoolOverridesEditor({ tier, plans, current, onSaved }) {
  const [draft, setDraft] = useState(() => toDraft(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plan = plans?.[tier] ?? null;

  const bad = Object.entries(draft.limits).filter(([, v]) => v.trim() !== '' && !/^\d+$/.test(v.trim()));

  const save = async (e) => {
    e.preventDefault();
    if (bad.length) { setError(`${bad.map(([k]) => LIMIT_LABELS[k]).join(', ')}: a whole number from 0, or empty for the plan's.`); return; }
    setBusy(true);
    setError('');
    const limits = Object.fromEntries(Object.entries(draft.limits).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)]));
    const features = Object.fromEntries(Object.entries(draft.features).filter(([, v]) => v).map(([k, v]) => [k, v === 'on']));
    try {
      const res = await saveSchoolOverrides({ limits, features });
      onSaved?.(res.custom ? 'Custom limits saved.' : 'Back to the plan as it is.');
    } catch (err) {
      setError(err?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-3 border-top pt-3" onSubmit={save} data-testid="school-overrides" aria-label="Custom limits and features">
      <p className="small text-muted mb-2">For this school only, on top of its plan. Empty follows the plan.</p>
      {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
      <div className="row g-2 mb-2">
        {Object.entries(LIMIT_LABELS).map(([k, label]) => (
          <div className="col-6 col-md-3" key={k}>
            <label className="form-label small mb-0" htmlFor={`ovr-limit-${k}`}>{label}</label>
            <input id={`ovr-limit-${k}`} type="text" inputMode="numeric" className="form-control form-control-sm"
              placeholder={plan ? String(plan.limits?.[k] ?? '') : ''}
              value={draft.limits[k]} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [k]: e.target.value } })} />
          </div>
        ))}
      </div>
      <div className="row g-2 mb-2">
        {Object.entries(FEATURE_LABELS).map(([k, label]) => (
          <div className="col-12 col-md-6 d-flex align-items-center gap-2" key={k}>
            <select id={`ovr-feature-${k}`} className="form-select form-select-sm w-auto" value={draft.features[k]}
              onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [k]: e.target.value } })}>
              {FEATURE_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>{c.id ? c.label : `Plan's (${plan?.features?.[k] ? 'on' : 'off'})`}</option>
              ))}
            </select>
            <label className="small" htmlFor={`ovr-feature-${k}`}>{label}</label>
          </div>
        ))}
      </div>
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save custom limits'}</button>
    </form>
  );
}
