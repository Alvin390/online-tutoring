import { Link } from 'react-router-dom';
import { useAuthState } from '@features/auth/context/AuthContext';
import { TIERS, TIER_RANK, formatKes } from '@shared/constants/tiers';
import { ROUTES } from '@/routes/routeConfig';

/**
 * Client-side tier gate — Phase 12 follow-up.
 *
 * Nine endpoints declare a minimum tier in `createHandler` and enforce it with
 * `requireTier`. Until now nothing on the client knew about those, so a Bronze
 * teacher was shown the Fees panel, used it, and got back
 * "You do not have permission to do that." — a refusal that reads as a bug in
 * the product rather than as a plan boundary.
 *
 * This closes that gap from the front. The rule here is deliberately IDENTICAL
 * to `requireTier` in api/_lib/auth.js:
 *
 *     superadmin passes anything;  otherwise tierRank >= the required rank
 *
 * If the two ever drift, the gate is worse than useless: it either hides
 * something the server would have allowed, or promises something the server
 * will still refuse. So when a handler's `tier:` changes, change it here too.
 *
 * SHOWN, NOT HIDDEN. The locked panel is replaced by a prompt naming the
 * feature and the plan that carries it, rather than disappearing. That is the
 * same choice `WhatsAppPanel` already makes for its Gold controls, for the same
 * reason: a teacher who never sees a capability never buys it, and a dashboard
 * whose contents change shape between plans is hard to support ("what do you
 * mean, there's no Fees section?").
 *
 * Deliberately NOT conditioned on the `billing.enabled` flag. The server's
 * `requireTier` is not, and mirroring the server is the entire point.
 */
export default function TierGate({ tier, feature, description = null, children }) {
  const { tierRank, isSuperadmin } = useAuthState();

  const required = TIER_RANK[tier] ?? Infinity;
  const allowed = isSuperadmin || (tierRank ?? 0) >= required;

  if (allowed) return children;

  return <UpgradePrompt tier={tier} feature={feature} description={description} />;
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
