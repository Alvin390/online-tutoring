import { apiGet, apiPost } from './client';

/**
 * Billing calls — Phase 03.
 *
 * `initializeCheckout` takes a tier NAME and a channel, never an amount. The
 * server looks the price up from the tier; the endpoint's Zod schema is strict,
 * so a body carrying `amount` is rejected rather than ignored.
 */

export const getBillingStatus = () => apiGet('/api/billing/status');

export const initializeCheckout = (tier, channel) =>
  apiPost('/api/billing/initialize', { tier, channel });

export const cancelSubscription = () => apiPost('/api/billing/manage', { action: 'cancel' });

export const resumeSubscription = () => apiPost('/api/billing/manage', { action: 'resume' });

export const scheduleDowngrade = (tier) =>
  apiPost('/api/billing/manage', { action: 'schedule_downgrade', tier });

/** Superadmin only — grants a tier with no payment. */
export const grantTier = (tier) => apiPost('/api/billing/manage', { action: 'grant', tier });
