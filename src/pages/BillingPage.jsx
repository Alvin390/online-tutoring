import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBilling } from '@features/billing/context/BillingContext';
import { useToast } from '@/context/ToastContext';
import { TIERS, TIER_ORDER, TIER_RANK, formatKes } from '@shared/constants/tiers';
import {
  initializeCheckout,
  cancelSubscription,
  resumeSubscription,
  scheduleDowngrade,
} from '@services/api/billing';
import logger from '@utils/logger';

/**
 * Billing page — Phase 03 D3/D6/D8.
 *
 * The one non-obvious requirement this page carries: **the M-Pesa renewal
 * limitation is disclosed at the moment of choice**, not in terms of service.
 *
 * Paystack can only auto-charge card and bank authorizations
 * (paystack_docs.txt:1345); mobile-money authorizations are not reusable. So an
 * M-Pesa subscriber must renew by hand every month. Someone who discovers that
 * only when they get locked out has been misled, so the callout sits inline on
 * the M-Pesa option and is restated after payment.
 */

const CHANNELS = [
  {
    id: 'card',
    label: 'Card',
    icon: 'bi-credit-card',
    autoRenews: true,
    blurb: 'Renews automatically each month. Cancel any time.',
  },
  {
    id: 'mobile_money',
    label: 'M-Pesa',
    icon: 'bi-phone',
    autoRenews: false,
    blurb: 'Cannot renew automatically — you will renew by hand each month.',
  },
  // NO BANK OPTION. It was offered and always failed with "No active channel
  // to process transaction. Please contact merchant", because direct bank
  // debit is not available on a Kenyan Paystack account:
  //
  //   "Card payment channels are available on all Paystack accounts, while the
  //    other payment channels are only available in countries where they're
  //    supported."  — upgrade/paystack_docs.txt:4949
  //
  // Card and M-Pesa are the two that work for KES. Add bank back only for a
  // market where the account actually has it enabled.
];

const STATUS_COPY = {
  trialing: { label: 'Free trial', tone: 'info', icon: 'bi-hourglass-split' },
  active: { label: 'Active', tone: 'success', icon: 'bi-check-circle-fill' },
  past_due: { label: 'Payment due', tone: 'warning', icon: 'bi-exclamation-triangle-fill' },
  grace: { label: 'Grace period', tone: 'warning', icon: 'bi-clock-fill' },
  locked: { label: 'Locked', tone: 'danger', icon: 'bi-lock-fill' },
  cancelled: { label: 'Cancelling', tone: 'secondary', icon: 'bi-x-circle' },
  expired: { label: 'Expired', tone: 'danger', icon: 'bi-slash-circle' },
};

function formatDate(value) {
  if (!value) return null;
  const ms =
    typeof value === 'number'
      ? value
      : typeof value?.toMillis === 'function'
        ? value.toMillis()
        : typeof value?.seconds === 'number'
          ? value.seconds * 1000
          : Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString('en-KE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function BillingPage() {
  const { subscription, status, tier, isLocked, loading, refresh } = useBilling();
  const { showError, showSuccess } = useToast();

  const [selectedTier, setSelectedTier] = useState(null);
  const [channel, setChannel] = useState('card');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDowngrade, setConfirmDowngrade] = useState(null);

  const currentRank = TIER_RANK[tier] ?? 0;

  /**
   * Has the subscription actually ended?
   *
   * Only these two statuses cut access (subscription.js ACCESS_GRANTED lists
   * the rest as still granted), and they are the only ones where re-buying the
   * SAME plan is the natural action. In grace or past_due the teacher still has
   * what they paid for, so offering "Renew" there would be noise.
   */
  const hasLapsed = status === 'expired' || status === 'locked';
  const statusCopy = STATUS_COPY[status] ?? null;
  const chosenChannel = CHANNELS.find((c) => c.id === channel);

  const handleCheckout = async (tierId) => {
    setBusy(true);
    try {
      const result = await initializeCheckout(tierId, channel);

      if (!result.autoRenews) {
        // Restated after the choice, before the redirect — the second half of
        // "told at the moment of choice".
        showSuccess(
          'Taking you to M-Pesa. Remember: this plan does not renew automatically — we will remind you before it lapses.'
        );
      }

      window.location.href = result.authorizationUrl;
    } catch (err) {
      logger.error('Checkout failed', err);
      showError(err?.message ?? 'Could not start checkout. Please try again.');
      setBusy(false);
    }
  };

  /**
   * A downgrade is NOT a purchase, and must not run checkout.
   *
   * This button used to call handleCheckout(tier), which charged the teacher
   * the full lower-tier price immediately, restarted the billing period —
   * discarding the remainder of the period they had already paid for — and, on
   * card, left the previous subscription running at Paystack. The note beneath
   * it has always promised "takes effect at the end of your current period",
   * which is what api/billing/manage.js schedule_downgrade actually does. That
   * endpoint existed and simply had no caller.
   */
  const handleDowngrade = async (tierId) => {
    setBusy(true);
    try {
      const result = await scheduleDowngrade(tierId);
      showSuccess(
        `Scheduled. You keep ${TIERS[tier]?.name ?? 'your current plan'} until ${
          formatDate(result.effectiveAt) ?? 'the end of your period'
        }, then move to ${TIERS[tierId]?.name}.`
      );
      setConfirmDowngrade(null);
      await refresh();
    } catch (err) {
      logger.error('Downgrade scheduling failed', err);
      showError(err?.message ?? 'Could not schedule that change.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      const result = await cancelSubscription();
      showSuccess(
        `Cancelled. You keep full access until ${formatDate(result.accessUntil) ?? 'the end of your period'}.`
      );
      setConfirmCancel(false);
      await refresh();
    } catch (err) {
      showError(err?.message ?? 'Could not cancel. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    try {
      await resumeSubscription();
      showSuccess('Your subscription will continue as normal.');
      await refresh();
    } catch (err) {
      showError(err?.message ?? 'Could not resume. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-5" style={{ maxWidth: 1100 }}>
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <div>
          <h1 className="fw-bold h3 mb-1">Your plan</h1>
          <p className="text-muted mb-0">Manage your subscription and billing.</p>
        </div>
        {!isLocked && (
          <Link to="/dashboard" className="btn btn-outline-secondary">
            <i className="bi bi-arrow-left me-2" aria-hidden="true" />
            Back to dashboard
          </Link>
        )}
      </div>

      {/* Lockout notice. Never says "you didn't pay" to anyone but the teacher,
          and students see an entirely different message elsewhere. */}
      {isLocked && (
        <div className="alert alert-danger d-flex gap-3 align-items-start" role="alert">
          <i className="bi bi-lock-fill fs-4" aria-hidden="true" />
          <div>
            <h2 className="h6 fw-bold mb-1">Your account is locked</h2>
            <p className="mb-0">
              Your students currently see &ldquo;classes are temporarily unavailable&rdquo;.
              Renewing below restores everything immediately — none of your data has
              been touched.
            </p>
          </div>
        </div>
      )}

      {/* Current status */}
      {!loading && statusCopy && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card mb-4"
        >
          <div className="card-body d-flex flex-wrap gap-4 align-items-center justify-content-between">
            <div>
              <span className="text-muted small d-block">Current plan</span>
              <span className="fs-4 fw-bold">
                {tier ? TIERS[tier]?.name : 'No plan'}{' '}
                <span className={`badge text-bg-${statusCopy.tone} align-middle`}>
                  {/* Icon + text, never colour alone. */}
                  <i className={`bi ${statusCopy.icon} me-1`} aria-hidden="true" />
                  {statusCopy.label}
                </span>
              </span>
            </div>

            {subscription?.currentPeriodEnd && (
              <div>
                <span className="text-muted small d-block">
                  {subscription.cancelAtPeriodEnd ? 'Access ends' : 'Renews on'}
                </span>
                <span className="fw-semibold">{formatDate(subscription.currentPeriodEnd)}</span>
              </div>
            )}

            {subscription?.renewalMode && (
              <div>
                <span className="text-muted small d-block">Renewal</span>
                <span className="fw-semibold">
                  {subscription.renewalMode === 'auto' ? 'Automatic' : 'Manual (M-Pesa)'}
                </span>
              </div>
            )}

            <div className="ms-auto">
              {subscription?.cancelAtPeriodEnd ? (
                <button className="btn btn-primary" onClick={handleResume} disabled={busy}>
                  Keep my subscription
                </button>
              ) : (
                tier && (
                  <button
                    className="btn btn-outline-danger"
                    onClick={() => setConfirmCancel(true)}
                    disabled={busy}
                  >
                    Cancel subscription
                  </button>
                )
              )}
            </div>
          </div>

          {subscription?.scheduledTierChange?.tier && (
            <div className="card-footer bg-light small">
              <i className="bi bi-info-circle me-2" aria-hidden="true" />
              Changing to <strong>{TIERS[subscription.scheduledTierChange.tier]?.name}</strong> on{' '}
              {formatDate(subscription.currentPeriodEnd)}. Your data from this plan is kept
              and comes back if you upgrade again.
            </div>
          )}
        </motion.div>
      )}

      {/* Cancel confirmation — states the exact date, per Q8. */}
      {confirmCancel && (
        <div className="alert alert-warning" role="alert">
          <h2 className="h6 fw-bold">Cancel your subscription?</h2>
          <p>
            You keep full access until{' '}
            <strong>{formatDate(subscription?.currentPeriodEnd) ?? 'the end of your period'}</strong>.
            Nothing is deleted, and you can undo this at any point before then.
          </p>
          <div className="d-flex gap-2">
            <button className="btn btn-danger btn-sm" onClick={handleCancel} disabled={busy}>
              Yes, cancel
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setConfirmCancel(false)}
              disabled={busy}
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {/* Downgrade confirmation. Names the date and the new price, because the
          two questions a teacher has are "when does this bite" and "what will I
          pay". Nothing is charged now. */}
      {confirmDowngrade && (
        <div className="alert alert-warning" role="alert">
          <h2 className="h6 fw-bold">
            Move to {TIERS[confirmDowngrade]?.name} at the end of this period?
          </h2>
          <p className="mb-2">
            You keep <strong>{TIERS[tier]?.name ?? 'your current plan'}</strong> and everything
            in it until{' '}
            <strong>{formatDate(subscription?.currentPeriodEnd) ?? 'the end of your period'}</strong>.
            From then you pay{' '}
            <strong>{formatKes(TIERS[confirmDowngrade]?.priceKes ?? 0)}</strong>/month instead of{' '}
            {formatKes(TIERS[tier]?.priceKes ?? 0)}.
          </p>
          <p className="small text-muted mb-3">
            <strong>You are not charged now.</strong> Your fees, calendar and campaign history
            from the higher plan are kept and hidden, and come back if you upgrade again.
            You can undo this before the date by choosing your current plan again.
          </p>
          <div className="d-flex gap-2">
            <button
              className="btn btn-warning btn-sm"
              onClick={() => handleDowngrade(confirmDowngrade)}
              disabled={busy}
            >
              {busy ? <span className="spinner-border spinner-border-sm me-2" /> : null}
              Schedule the change
            </button>
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setConfirmDowngrade(null)}
              disabled={busy}
            >
              Keep {TIERS[tier]?.name ?? 'my plan'}
            </button>
          </div>
        </div>
      )}

      {/* Payment method — chosen BEFORE the plan, because it changes what the
          plan buttons mean. */}
      <h2 className="h5 fw-bold mt-5 mb-3">How would you like to pay?</h2>
      <div className="row g-3 mb-2">
        {CHANNELS.map((c) => (
          <div className="col-md-4" key={c.id}>
            <button
              type="button"
              className={`card h-100 w-100 text-start border-2 ${
                channel === c.id ? 'border-primary' : 'border-light'
              }`}
              onClick={() => setChannel(c.id)}
              aria-pressed={channel === c.id}
            >
              <div className="card-body">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className={`bi ${c.icon} fs-4`} aria-hidden="true" />
                  <span className="fw-bold">{c.label}</span>
                  {!c.autoRenews && (
                    <span className="badge text-bg-warning ms-auto">Manual renewal</span>
                  )}
                </div>
                <p className="small text-muted mb-0">{c.blurb}</p>
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* The disclosure. Inline, at the moment of choice — not in terms. */}
      {chosenChannel && !chosenChannel.autoRenews && (
        <div className="alert alert-warning d-flex gap-3 align-items-start" role="alert">
          <i className="bi bi-info-circle-fill fs-5" aria-hidden="true" />
          <div>
            <strong>M-Pesa cannot renew automatically.</strong> Our payment provider can
            only set up automatic monthly charges on cards and bank accounts. You will
            get reminders 7 days, 3 days, 1 day and 2 hours before your plan lapses, and
            you renew by hand each month. Choose <strong>Card</strong> if you would
            rather not think about it.
          </div>
        </div>
      )}

      {/* Plans */}
      <h2 className="h5 fw-bold mt-5 mb-3">Choose a plan</h2>
      <div className="row g-4">
        {TIER_ORDER.map((id) => {
          const plan = TIERS[id];
          const isCurrent = tier === id;
          const isDowngrade = TIER_RANK[id] < currentRank;
          // The renew button appears ONLY on the plan they were already on,
          // and only once it has lapsed. Every other card keeps its normal
          // upgrade/switch action so they can move plan instead of renewing.
          const isRenewal = isCurrent && hasLapsed;

          return (
            <div className="col-md-4" key={id}>
              <div className={`card h-100 ${isCurrent ? 'border-primary border-2' : ''}`}>
                <div className="card-body d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start">
                    <h3 className="h5 fw-bold mb-0">{plan.name}</h3>
                    {isCurrent && <span className="badge text-bg-primary">Current</span>}
                  </div>
                  <p className="text-muted small">{plan.tagline}</p>

                  <div className="my-3">
                    <span className="fs-3 fw-bold">{formatKes(plan.priceKes)}</span>
                    <span className="text-muted">/month</span>
                  </div>

                  <ul className="list-unstyled small flex-grow-1">
                    {plan.features.map((f) => (
                      <li key={f} className="mb-1">
                        <i className="bi bi-check2 text-success me-2" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    className={`btn w-100 ${
                      isRenewal ? 'btn-success' : isCurrent ? 'btn-outline-secondary' : 'btn-primary'
                    }`}
                    // A lapsed plan is buyable again, so "your current plan"
                    // must stop disabling the button once the subscription has
                    // ended — otherwise the one plan the teacher most wants to
                    // pay for is the only one they cannot click.
                    disabled={busy || (isCurrent && !hasLapsed)}
                    onClick={() => {
                      setSelectedTier(id);
                      // A downgrade schedules; everything else buys.
                      if (isDowngrade && !hasLapsed) setConfirmDowngrade(id);
                      else handleCheckout(id);
                    }}
                  >
                    {busy && selectedTier === id ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" />
                        Starting checkout…
                      </>
                    ) : isRenewal ? (
                      <>
                        <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
                        {`Renew ${plan.name}`}
                      </>
                    ) : isCurrent ? (
                      'Your current plan'
                    ) : isDowngrade ? (
                      `Switch to ${plan.name}`
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </button>

                  {/* Only while a period is actually running. Once the
                      subscription has lapsed there is no period left to ride
                      out, so this becomes an ordinary purchase and the promise
                      would be false. */}
                  {isDowngrade && !hasLapsed && (
                    <p className="small text-muted mt-2 mb-0">
                      Takes effect at the end of your current period. Nothing is deleted.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
