import { useMemo } from 'react';
import { useAuthState } from '@features/auth/context/AuthContext';
import { useOptionalBilling } from '../context/billingContextValue';
import { planFor } from '@shared/constants/plans';

const RANK_TO_TIER = { 1: 'bronze', 2: 'silver', 3: 'gold' };

/**
 * The school's plan on the screen — 013Fixes / 00.
 *
 * The source of truth is the plan `/api/billing/status` returns: the SAME
 * `schoolPlan()` the server gates use (the school's subscription plus the
 * superadmin's plan settings). Every login of a school therefore sees the
 * same plan, whatever its own claims say.
 *
 * Until that answer arrives (and if it fails, or outside a BillingProvider —
 * isolated component tests), the login's own claim stands in, read through
 * the shipped plan table. That is only a stand-in: it avoids a flash of
 * upgrade cards for the owner, whose claims the hourly sweep keeps in step.
 * A login with no claim at all waits (`pending`) instead of being shown
 * upgrade cards it may not deserve.
 *
 * `has(feature)` mirrors `requireFeature` on the server: the superadmin may
 * use anything; otherwise the plan must include the feature.
 *
 * @returns {{ tier: string|null, features: Record<string, boolean>,
 *   limits: Record<string, number>, has: (feature: string) => boolean,
 *   pending: boolean, source: 'school'|'claims' }}
 */
export function usePlan() {
  const { tier: claimTierRaw, tierRank, isSuperadmin } = useAuthState();
  const billing = useOptionalBilling();

  const serverPlan = billing?.plan ?? null;
  const claimTier = claimTierRaw ?? RANK_TO_TIER[tierRank] ?? null;
  const waiting = Boolean(billing?.loading) && !serverPlan;
  const superadmin = isSuperadmin === true;

  return useMemo(() => {
    const tier = serverPlan ? (serverPlan.tier ?? null) : claimTier;
    const base = serverPlan?.features ? serverPlan : planFor(tier);
    const features = base.features;
    const limits = base.limits;
    return {
      tier,
      features,
      limits,
      has: (feature) => superadmin || features?.[feature] === true,
      pending: !superadmin && waiting && !claimTier,
      source: serverPlan ? 'school' : 'claims',
    };
  }, [serverPlan, claimTier, waiting, superadmin]);
}

export default usePlan;
