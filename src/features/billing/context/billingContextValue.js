import { createContext, useContext } from 'react';

/**
 * The billing context OBJECT, on its own — 013Fixes / 00.
 *
 * Kept apart from BillingContext.jsx (the provider, which imports Firestore)
 * so `usePlan` — used by many dashboard components — can read the context
 * without pulling the Firebase setup into every component that gates on the
 * plan. BillingContext.jsx re-exports it, so existing imports are unchanged.
 */
export const BillingContext = createContext(null);

/** The billing state, or null outside a BillingProvider (usePlan falls back). */
export function useOptionalBilling() {
  return useContext(BillingContext);
}
