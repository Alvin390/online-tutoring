import { useState } from 'react';
import Modal from '@shared/components/ui/Modal';
import { TIER_ORDER } from '@shared/constants/tiers';
import {
  changeSchoolPlan, extendSchool, lockSchool, unlockSchool, giftSchoolPlan, cancelSchoolPlan,
} from '@services/api/adminBilling';
import { formatNairobi } from '@/features/billing/planEnd';
import { amountText, methodLabel, paidOn } from '@/features/billing/payments/paymentFormat';
import {
  tierName, statusBadge, daysLeftText, endLabel, isDowngrade, planLosses, endOfNairobiDay,
} from '../accountCardText';
import AccountNotes from './AccountNotes';
import SchoolOverridesEditor from './SchoolOverridesEditor';

/**
 * The school's account card, at the top of Accounts — 013Fixes / 22b (owner
 * suggestions 2, 3, 4 and 8). The plan, its status and days left, the end
 * (the same window the school's own countdown uses), a month waiting, the
 * last payment and the SMS units; then the actions, each confirmed in plain
 * words; then the private notes and the school's own limits and features.
 *
 * Everything comes with the Accounts list (no read of its own); notes load
 * when opened.
 */

const D = 86_400_000;
const CARD_REFUSAL = 'Paying by card: Paystack would bill the old plan or undo the change. Cancel the card first.';

export default function AccountCard({ subscription: sub, plans, sms, prices = null, onChanged }) {
  const [dialog, setDialog] = useState(null);
  const [tier, setTier] = useState('');
  const [days, setDays] = useState('7');
  const [untilDay, setUntilDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);

  if (!sub) return null;

  const badge = statusBadge(sub);
  const left = daysLeftText(sub);
  const locked = sub.status === 'locked' || sub.status === 'expired';
  const comp = sub.grantedBySuperadmin === true;
  const running = ['trialing', 'active', 'cancelled'].includes(sub.status);

  const open = (kind) => {
    setError('');
    setTier(kind === 'gift' ? (sub.tier ?? 'gold') : (TIER_ORDER.find((t) => t !== sub.tier) ?? 'gold'));
    setDialog(kind);
  };
  const close = () => { if (!busy) setDialog(null); };

  const daysN = Number(days);
  const daysOk = Number.isInteger(daysN) && daysN >= 1 && daysN <= 365;
  const until = endOfNairobiDay(untilDay);
  const untilOk = until != null && until > Date.now() && until <= Date.now() + 366 * D;
  const losses = dialog === 'changePlan' && isDowngrade(sub.tier, tier) ? planLosses(plans, sub.tier, tier) : null;

  const DIALOGS = {
    changePlan: {
      title: 'Change plan',
      confirm: 'Change plan',
      ready: Boolean(tier) && tier !== sub.tier,
      run: () => changeSchoolPlan(tier),
      done: `Plan changed to ${tierName(tier)}.`,
    },
    extend: {
      title: 'Extend',
      confirm: 'Extend',
      ready: daysOk,
      run: () => extendSchool(daysN),
      done: `Extended by ${daysN} day${daysN === 1 ? '' : 's'}.`,
    },
    lock: { title: 'Lock now', confirm: 'Lock now', type: 'danger', ready: true, run: () => lockSchool(), done: 'The school is locked.' },
    unlock: {
      title: 'Unlock',
      confirm: 'Unlock',
      ready: untilOk,
      run: () => unlockSchool(until),
      done: 'The school is open again.',
    },
    gift: { title: 'Gift plan', confirm: 'Gift plan', ready: Boolean(tier), run: () => giftSchoolPlan(tier), done: `${tierName(tier)} gifted.` },
    cancel: { title: 'Cancel', confirm: 'Cancel at the end', type: 'danger', ready: true, run: () => cancelSchoolPlan(), done: 'Cancelled at the end of the period.' },
  };
  const d = dialog ? DIALOGS[dialog] : null;

  const confirm = async () => {
    if (!d?.ready) return;
    setBusy(true);
    setError('');
    try {
      const res = await d.run();
      setDialog(null);
      onChanged?.(dialog === 'unlock' && res?.queued ? 'The school is open until its paid month begins.' : d.done);
    } catch (err) {
      setError(err?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border rounded p-3 mb-3 bg-light" data-testid="account-card">
      <div className="d-flex flex-wrap gap-4 align-items-start">
        <div>
          <span className="text-muted small d-block">Plan</span>
          <strong data-testid="account-plan">{tierName(sub.tier)}</strong>{' '}
          <span className={`badge text-bg-${badge.tone}`} data-testid="account-status">{badge.text}</span>
          {sub.custom && <span className="badge text-bg-dark ms-1" data-testid="account-custom">custom</span>}
          {left && <span className="d-block small text-muted" data-testid="account-days-left">{left}</span>}
          {prices?.[sub.tier] != null && (
            <span className="d-block small text-muted" data-testid="account-price">{amountText(prices[sub.tier])} a month</span>
          )}
        </div>
        {!comp && sub.endsAt != null && (
          <div>
            <span className="text-muted small d-block">{endLabel(sub)}</span>
            <strong data-testid="account-end">{formatNairobi(sub.endsAt)}</strong>
          </div>
        )}
        {sub.nextPeriodStart != null && (
          <div>
            <span className="text-muted small d-block">Paid month waiting</span>
            <strong data-testid="account-next">{tierName(sub.nextTier ?? sub.tier)} from {formatNairobi(sub.nextPeriodStart)}</strong>
          </div>
        )}
        <div>
          <span className="text-muted small d-block">Last payment</span>
          <strong data-testid="account-last-payment">
            {sub.lastPaymentAt != null
              ? `${amountText(sub.lastPaymentAmountKes)} by ${methodLabel(sub.lastPaymentMethod)} on ${paidOn(sub.lastPaymentAt)}`
              : 'None recorded'}
          </strong>
        </div>
        {sms && (
          <div>
            <span className="text-muted small d-block">SMS units</span>
            <strong data-testid="account-sms">{Number(sms.available ?? 0).toLocaleString('en-KE')} left</strong>
          </div>
        )}
      </div>

      <div className="d-flex flex-wrap gap-2 mt-3" aria-label="Account actions">
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => open('changePlan')} disabled={sub.card} title={sub.card ? CARD_REFUSAL : undefined}>Change plan</button>
        {running && !comp && (
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => open('extend')} disabled={sub.card} title={sub.card ? CARD_REFUSAL : undefined}>Extend by days</button>
        )}
        {!locked && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => open('lock')}>Lock now</button>}
        {locked && <button type="button" className="btn btn-sm btn-outline-success" onClick={() => open('unlock')}>Unlock until…</button>}
        <button type="button" className="btn btn-sm btn-outline-info" onClick={() => open('gift')}>Gift plan</button>
        {running && !comp && !sub.cancelAtPeriodEnd && sub.status !== 'cancelled' && (
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => open('cancel')}>Cancel</button>
        )}
        <button type="button" className="btn btn-sm btn-link" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>Notes</button>
        <button type="button" className="btn btn-sm btn-link" onClick={() => setShowOverrides((v) => !v)} aria-expanded={showOverrides}>Custom limits</button>
      </div>
      {sub.card && <p className="small text-muted mt-2 mb-0">{CARD_REFUSAL}</p>}

      {showNotes && <AccountNotes />}
      {showOverrides && <SchoolOverridesEditor tier={sub.tier} plans={plans} current={sub.schoolOverrides} onSaved={onChanged} />}

      {d && (
        <Modal
          title={d.title}
          onClose={close}
          footer={(
            <>
              <button type="button" className="btn btn-outline-secondary" onClick={close} disabled={busy}>Back</button>
              <button type="button" className={`btn btn-${d.type ?? 'primary'}`} onClick={confirm} disabled={!d.ready || busy}>
                {busy ? 'Working…' : d.confirm}
              </button>
            </>
          )}
        >
          {error && <div className="alert alert-danger small py-2" role="alert">{error}</div>}
          <div data-testid="account-dialog">
            {(dialog === 'changePlan' || dialog === 'gift') && (
              <div className="mb-2">
                <label className="form-label small fw-semibold" htmlFor="account-tier">Plan</label>
                <select id="account-tier" className="form-select" value={tier} onChange={(e) => setTier(e.target.value)}>
                  {TIER_ORDER.map((t) => <option key={t} value={t}>{tierName(t)}</option>)}
                </select>
              </div>
            )}
            {dialog === 'changePlan' && (
              <>
                <p className="small mb-1">From {tierName(sub.tier)} to {tierName(tier)}, now. The period's dates stay the same.</p>
                {losses && (losses.features.length > 0 || losses.limits.length > 0) && (
                  <div className="alert alert-warning small py-2 mb-0" data-testid="downgrade-warning">
                    <strong>The school loses:</strong>
                    <ul className="mb-0">
                      {losses.features.map((f) => <li key={f}>{f}</li>)}
                      {losses.limits.map((l) => <li key={l.label}>{l.label}: {l.from} → {l.to}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
            {dialog === 'extend' && (
              <>
                <label className="form-label small fw-semibold" htmlFor="account-days">Days to add</label>
                <input id="account-days" type="number" min={1} max={365} step={1} className="form-control" value={days} onChange={(e) => setDays(e.target.value)} />
                {daysOk && sub.endsAt != null && (
                  <p className="small mt-2 mb-0">The end moves from {formatNairobi(sub.endsAt)} to {formatNairobi(sub.endsAt + daysN * D)}.</p>
                )}
              </>
            )}
            {dialog === 'lock' && <p className="mb-0">Lock the school now? Teachers and students lose access straight away.</p>}
            {dialog === 'unlock' && (
              <>
                <label className="form-label small fw-semibold" htmlFor="account-until">Open until</label>
                <input id="account-until" type="date" className="form-control" value={untilDay} onChange={(e) => setUntilDay(e.target.value)} />
                {untilOk && <p className="small mt-2 mb-0">Open until {formatNairobi(until)}, then it locks again unless a payment comes in.</p>}
                {sub.nextPeriodStart != null && (
                  <p className="small mt-2 mb-0 text-muted">A paid month is waiting: the school stays open until it begins ({formatNairobi(sub.nextPeriodStart)}).</p>
                )}
              </>
            )}
            {dialog === 'gift' && <p className="small mb-0">A gifted plan never ends and is never charged, until you change it.</p>}
            {dialog === 'cancel' && (
              <p className="mb-0">Cancel at the end of the period{sub.endsAt != null ? ` (${formatNairobi(sub.endsAt)})` : ''}? The school keeps access until then. A card subscription is switched off too.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
