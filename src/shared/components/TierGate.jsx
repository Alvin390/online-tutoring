import { Link } from 'react-router-dom';
import { usePlan } from '@features/billing/hooks/usePlan';
import { TIERS, formatKes } from '@shared/constants/tiers';
import { lowestPlanWith } from '@shared/constants/plans';
import { ROUTES } from '@/routes/routeConfig';

/**
 * Client-side plan gate — Phase 12 follow-up; 013Fixes / 00.
 *
 * Every endpoint that declares a plan `feature:` in `createHandler` (or checks
 * one with `requireFeature`) has a gate here, so a teacher is shown a plan
 * boundary rather than "You do not have permission to do that."
 *
 * The rule is deliberately IDENTICAL to `requireFeature` in
 * api/_lib/schoolPlan.js, and reads the same thing — the SCHOOL's plan
 * (usePlan), never the login's own claims:
 *
 *     superadmin passes anything;  otherwise the plan must include `requires`
 *
 * If the two ever drift, the gate is worse than useless: it either hides
 * something the server would have allowed, or promises something the server
 * will still refuse. tests/unit/tierGate.test.jsx pairs every server feature
 * with a gate here.
 *
 * SHOWN, NOT HIDDEN. The locked panel is replaced by a prompt naming the
 * feature and the cheapest plan that carries it, rather than disappearing:
 * a teacher who never sees a capability never buys it.
 *
 * While the school's plan is still loading for a login with no stand-in
 * (`pending`), nothing is rendered — never an upgrade card the school may not
 * deserve.
 *
 * Deliberately NOT conditioned on the `billing.enabled` flag, like the server.
 */
export default function TierGate({ requires, feature, description = null, children }) {
  const plan = usePlan();

  if (plan.has(requires)) return children;
  if (plan.pending) return null;

  return <UpgradePrompt tier={lowestPlanWith(requires)} feature={feature} description={description} />;
}

/**
 * The locked state. A card rather than a banner, so it occupies the same slot
 * in the page the real panel would have — the teacher sees where the feature
 * lives, not just that it exists.
 */
export function UpgradePrompt({ tier, feature, description = null }) {
  const plan = TIERS[tier];
  if (!plan) return null;

  return (
    <div className="card mb-4 border-warning-subtle animate-fade-in-up">
      <div className="card-body d-flex flex-column flex-md-row align-items-md-center gap-3">
        <div
          className="d-flex align-items-center justify-content-center rounded-circle bg-warning-subtle text-warning-emphasis flex-shrink-0"
          style={{ width: 48, height: 48 }}
          aria-hidden="true"
        >
          <i className="bi bi-lock-fill fs-4" />
        </div>

        <div className="flex-grow-1">
          <h5 className="mb-1 fw-bold">
            {feature}
            <span className="badge text-bg-warning ms-2 align-middle">{plan.name}</span>
          </h5>
          <p className="mb-0 text-muted small">
            {description ?? plan.tagline}
            {' — '}
            available on the {plan.name} plan at {formatKes(plan.priceKes)}/month.
          </p>
        </div>

        <Link
          to={ROUTES.BILLING}
          state={{ upgradeTo: tier }}
          className="btn btn-warning fw-semibold flex-shrink-0"
        >
          <i className="bi bi-arrow-up-circle me-1" />
          Upgrade to {plan.name}
        </Link>
      </div>
    </div>
  );
}
