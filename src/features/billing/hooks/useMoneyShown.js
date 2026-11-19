import { useFlag } from '@shared/config/FlagsContext';
import { usePlan } from './usePlan';

/**
 * Whether the dashboard shows money (balances, owing, partial payments) —
 * 013Fixes / 05: fees switched on AND fees in the school's plan (Silver and
 * up). On Bronze, or after a downgrade, the fee data is kept but not shown.
 */
export function useMoneyShown() {
  const feesOn = useFlag('fees.enabled');
  const plan = usePlan();
  return feesOn === true && plan.has('fees');
}

export default useMoneyShown;
