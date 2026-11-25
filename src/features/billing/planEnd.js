/**
 * The billing page's "Your plan expires on …" — 013Fixes / 18 (owner answers
 * round 3: "a clear plan expires on … on the billing page"). Pure, so the
 * wording is tested without rendering the page.
 *
 *   a card expected to renew      "Renews on <period end>"
 *   cancelled                     "Access ends on <period end>"
 *   anything else with an end     "Your plan expires on <when access stops>"
 *   a comp (gift) plan, or none   null — nothing to say
 */

const toMs = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/** "3 December 2026, 5:00 pm", in Nairobi time whatever the device's zone. */
export function formatNairobi(ms) {
  if (ms == null) return null;
  return new Date(ms).toLocaleString('en-KE', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Nairobi',
  });
}

export function planEnd(subscription) {
  if (!subscription || subscription.comp === true) return null;
  const periodEnd = toMs(subscription.currentPeriodEnd);
  if (subscription.cancelAtPeriodEnd === true && periodEnd != null) {
    return { label: 'Access ends on', at: periodEnd, text: formatNairobi(periodEnd) };
  }
  if (subscription.renews === true && periodEnd != null) {
    return { label: 'Renews on', at: periodEnd, text: formatNairobi(periodEnd) };
  }
  const endsAt = toMs(subscription.endsAt) ?? toMs(subscription.trialEndsAt) ?? periodEnd;
  if (endsAt == null) return null;
  return { label: 'Your plan expires on', at: endsAt, text: formatNairobi(endsAt) };
}
