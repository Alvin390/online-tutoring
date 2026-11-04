import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { formatKes } from '@utils/blockReason';
import { dayKey } from '@shared/utils/dates';
import logger from '@utils/logger';

/**
 * Fee KPI cards — Phase 06 D10.
 *
 * Every figure comes from `aggregates/dashboard`, maintained by
 * `FieldValue.increment` inside the same transaction that posts each ledger
 * entry. So this costs ONE document read regardless of whether the teacher has
 * 12 students or 1,200 — rather than fetching every student to add up a number,
 * which is the pattern that quietly turns a dashboard into the most expensive
 * page in the app.
 */

const CARDS = [
  {
    key: 'collectedThisMonth',
    label: 'Collected this month',
    icon: 'bi-cash-stack',
    tone: 'success',
    money: true,
  },
  {
    key: 'totalOutstanding',
    label: 'Total outstanding',
    icon: 'bi-hourglass-split',
    tone: 'warning',
    money: true,
  },
  {
    key: 'overdueCount',
    label: 'Overdue students',
    icon: 'bi-exclamation-triangle',
    tone: 'danger',
    money: false,
  },
];

/** "Morning: KES 1,500 outstanding · KES 1,500 this month" — 004Fixes / 09. */
function sessionLine(totals, thisMonth) {
  const outstanding = Math.max(0, Number(totals?.totalOutstanding ?? 0));
  const stale = totals?.collectedMonth && totals.collectedMonth !== thisMonth;
  const collected = stale ? 0 : Number(totals?.collectedThisMonth ?? 0);
  return `${formatKes(outstanding)} outstanding · ${formatKes(collected)} this month`;
}

/**
 * @param {{ sessions?: Array<{slug: string, name?: string}> }} props
 *   004Fixes / 09: the active sessions, for one line each under the cards
 *   (owner: money per session). A session with no fee activity reads 0.
 */
export default function FeeKpiCards({ sessions = [] }) {
  const [aggregates, setAggregates] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'aggregates', 'dashboard'),
      (snap) => setAggregates(snap.exists() ? snap.data() : {}),
      (error) => logger.warn('Aggregates listener failed', { code: error?.code })
    );
    return unsubscribe;
  }, []);

  if (!aggregates) return null;
  const thisMonth = dayKey(new Date()).slice(0, 7);

  return (
    <>
    <div className={`row g-3 ${sessions.length ? 'mb-2' : 'mb-4'}`}>
      {CARDS.map((card) => {
        // A total stamped with an earlier month is last month's: this month
        // has collected nothing yet. (No stamp: written before the stamp
        // existed, shown as is.)
        const stale = card.key === 'collectedThisMonth'
          && aggregates.collectedMonth
          && aggregates.collectedMonth !== dayKey(new Date()).slice(0, 7);
        const raw = stale ? 0 : Number(aggregates[card.key] ?? 0);
        // Outstanding can go negative if students are in credit; showing a
        // negative "outstanding" would read as a bug rather than as prepayment.
        const value = card.key === 'totalOutstanding' ? Math.max(0, raw) : raw;

        return (
          <div className="col-6 col-lg-4" key={card.key}>
            <div className="card h-100">
              <div className="card-body d-flex align-items-center gap-3">
                <div
                  className={`rounded-circle bg-${card.tone} bg-opacity-10 d-flex align-items-center justify-content-center flex-shrink-0`}
                  style={{ width: 44, height: 44 }}
                  aria-hidden="true"
                >
                  <i className={`bi ${card.icon} text-${card.tone} fs-5`} />
                </div>
                <div>
                  <div className="text-muted small">{card.label}</div>
                  <div className="fs-5 fw-bold">
                    {card.money ? formatKes(value) : value}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
    {sessions.length > 0 && (
      <ul className="list-unstyled small text-muted mb-4 d-flex flex-wrap column-gap-4 row-gap-1" data-testid="fee-kpi-sessions" aria-label="Money per session">
        {sessions.map((s) => (
          <li key={s.slug} data-testid="fee-kpi-session">
            <span className="fw-semibold text-body">{s.name ?? s.slug}:</span>{' '}
            {sessionLine(aggregates.bySession?.[s.slug], thisMonth)}
          </li>
        ))}
      </ul>
    )}
    </>
  );
}
