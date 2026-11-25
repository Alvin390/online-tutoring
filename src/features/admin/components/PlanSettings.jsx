import { useCallback, useEffect, useState } from 'react';
import { SkeletonList } from '@components/ui/Skeleton';
import { useToast } from '@/context/ToastContext';
import { getPlanSettings, savePlanSettings, resetPlanSettings } from '@services/api/admin';
import { PLAN_IDS, FEATURE_KEYS, LIMIT_KEYS, CARD_LIMITS, limitLines } from '@shared/constants/plans';
import { TIERS } from '@shared/constants/tiers';
import logger from '@utils/logger';
import { FEATURE_LABELS, LIMIT_LABELS } from '../planLabels';

/**
 * Plan settings — 013Fixes / 07 (superadmin only).
 *
 * What each plan includes, its included limits and its card's words, as
 * settings: no new code to change them. Saved to `config/plans` through
 * /api/admin/plans (validated, audited); the server refuses a save where a
 * cheaper plan has a feature a dearer one lacks. Prices are read-only here
 * (they change in the pricing series, with the Paystack plans).
 */

/** The editable form of one plan, from the effective settings. */
function toDraft(plan) {
  return {
    features: { ...plan.features },
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(plan.limits[k])])),
    tagline: plan.card.tagline,
    description: plan.card.description,
    bullets: plan.card.bullets.join('\n'),
  };
}

/** What a draft saves: only what differs from the shipped default. */
function toOverride(draft, defaults) {
  const features = {};
  for (const k of FEATURE_KEYS) if (draft.features[k] !== defaults.features[k]) features[k] = draft.features[k];
  const limits = {};
  for (const k of LIMIT_KEYS) {
    const n = Number(draft.limits[k]);
    if (n !== defaults.limits[k]) limits[k] = n;
  }
  const card = {};
  const bullets = draft.bullets.split('\n').map((b) => b.trim()).filter(Boolean);
  if (draft.tagline.trim() !== defaults.card.tagline) card.tagline = draft.tagline.trim();
  if (draft.description.trim() !== defaults.card.description) card.description = draft.description.trim();
  if (bullets.join('\n') !== defaults.card.bullets.join('\n')) card.bullets = bullets;
  return { features, limits, card };
}

/** Problems the server would refuse, shown before saving. */
function draftProblems(draft) {
  const problems = [];
  for (const k of LIMIT_KEYS) {
    const raw = draft.limits[k];
    if (!/^\d+$/.test(String(raw).trim()) || Number(raw) > 1_000_000) problems.push(`${LIMIT_LABELS[k]}: a whole number from 0`);
  }
  if (!draft.tagline.trim() || draft.tagline.length > CARD_LIMITS.tagline) problems.push(`Tagline: 1 to ${CARD_LIMITS.tagline} characters`);
  if (!draft.description.trim() || draft.description.length > CARD_LIMITS.description) problems.push(`Description: 1 to ${CARD_LIMITS.description} characters`);
  const bullets = draft.bullets.split('\n').map((b) => b.trim()).filter(Boolean);
  if (bullets.length < 1 || bullets.length > CARD_LIMITS.bullets) problems.push(`Card lines: 1 to ${CARD_LIMITS.bullets}`);
  if (bullets.some((b) => b.length > CARD_LIMITS.bullet)) problems.push(`Each card line: at most ${CARD_LIMITS.bullet} characters`);
  return problems;
}

export default function PlanSettings() {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getPlanSettings();
      setData(result);
      setDrafts(Object.fromEntries(PLAN_IDS.map((id) => [id, toDraft(result.effective[id])])));
    } catch (error) {
      logger.error('Plan settings failed to load', error);
      showError(error?.message ?? 'Could not load the plan settings.');
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);

  if (!data || !drafts) return <div className="card"><div className="card-body"><SkeletonList rows={4} /></div></div>;

  const setDraft = (id, change) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...change } }));

  const save = async (id) => {
    const problems = draftProblems(drafts[id]);
    if (problems.length) { showError(problems.join('. ')); return; }
    setBusy(true);
    try {
      await savePlanSettings({ [id]: toOverride(drafts[id], data.defaults[id]) });
      showSuccess(`${TIERS[id].name} saved. It applies everywhere within a minute.`);
      await load();
    } catch (error) {
      showError(error?.message ?? 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (id) => {
    setBusy(true);
    try {
      await resetPlanSettings(id);
      showSuccess(`${TIERS[id].name} is back to its default settings.`);
      await load();
    } catch (error) {
      showError(error?.message ?? 'That did not reset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="plan-settings">
      <div className="card-header">
        <h2 className="h5 mb-0"><i className="bi bi-sliders me-2" aria-hidden="true" />Plans</h2>
      </div>
      <div className="card-body">
        <p className="small text-muted">
          What each plan includes, its limits and the words on its card. A cheaper plan can never include
          something a dearer one doesn&apos;t. Prices change in the pricing settings (with Paystack).
        </p>
        <div className="row g-3">
          {PLAN_IDS.map((id) => {
            const draft = drafts[id];
            const customised = Boolean(data.overrides?.[id]);
            const preview = draftProblems(draft).length ? [] : limitLines(Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(draft.limits[k])])));
            return (
              <div className="col-lg-4" key={id}>
                <div className="border rounded p-3 h-100" data-testid={`plan-${id}`}>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <h3 className="h6 fw-bold mb-0">
                      {TIERS[id].name}
                      {customised && <span className="badge text-bg-info ms-2">Custom</span>}
                    </h3>
                    <span className="small text-muted">Price: see Prices above</span>
                  </div>

                  <fieldset className="mb-3">
                    <legend className="small fw-semibold">Includes</legend>
                    {FEATURE_KEYS.map((k) => (
                      <div className="form-check" key={k}>
                        <input
                          className="form-check-input" type="checkbox" id={`${id}-${k}`}
                          checked={draft.features[k] === true}
                          onChange={(e) => setDraft(id, { features: { ...draft.features, [k]: e.target.checked } })}
                        />
                        <label className="form-check-label small" htmlFor={`${id}-${k}`}>{FEATURE_LABELS[k] ?? k}</label>
                      </div>
                    ))}
                  </fieldset>

                  <fieldset className="mb-3">
                    <legend className="small fw-semibold">Limits</legend>
                    {LIMIT_KEYS.map((k) => (
                      <div className="mb-1" key={k}>
                        <label className="form-label small mb-0" htmlFor={`${id}-limit-${k}`}>{LIMIT_LABELS[k]}</label>
                        <input
                          id={`${id}-limit-${k}`} className="form-control form-control-sm" inputMode="numeric"
                          value={draft.limits[k]}
                          onChange={(e) => setDraft(id, { limits: { ...draft.limits, [k]: e.target.value } })}
                        />
                      </div>
                    ))}
                  </fieldset>

                  <fieldset className="mb-3">
                    <legend className="small fw-semibold">Card</legend>
                    <label className="form-label small mb-0" htmlFor={`${id}-tagline`}>Tagline</label>
                    <input id={`${id}-tagline`} className="form-control form-control-sm mb-1" maxLength={CARD_LIMITS.tagline}
                      value={draft.tagline} onChange={(e) => setDraft(id, { tagline: e.target.value })} />
                    <label className="form-label small mb-0" htmlFor={`${id}-description`}>Description</label>
                    <input id={`${id}-description`} className="form-control form-control-sm mb-1" maxLength={CARD_LIMITS.description}
                      value={draft.description} onChange={(e) => setDraft(id, { description: e.target.value })} />
                    <label className="form-label small mb-0" htmlFor={`${id}-bullets`}>Card lines (one per line)</label>
                    <textarea id={`${id}-bullets`} className="form-control form-control-sm" rows={6}
                      value={draft.bullets} onChange={(e) => setDraft(id, { bullets: e.target.value })} />
                    {preview.length > 0 && (
                      <div className="form-text">Added from the limits: {preview.join(' · ')}</div>
                    )}
                  </fieldset>

                  <div className="d-flex gap-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(id)}>Save {TIERS[id].name}</button>
                    {customised && (
                      <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => reset(id)}>Reset to default</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
