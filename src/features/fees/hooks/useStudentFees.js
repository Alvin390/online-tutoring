import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { db } from '@services/firebase/config';
import { getFeeSummary, recordPayment, reverseLedgerEntry, annotateLedgerEntry } from '@services/api/fees';
import { useToast } from '@/context/ToastContext';
import { formatKes } from '@utils/blockReason';
import logger from '@utils/logger';

/**
 * One student's fee state — Phase 06; LIVE since Phase 13 / 04 D2.
 *
 * Loaded only when the drawer's Fees tab is opened. Two listeners, both scoped
 * to this one student and torn down when the tab closes:
 *
 *   - the ledger, newest first, 50 at a time ("Show older" pages back with a
 *     cursor) — so an M-Pesa payment confirmed by Safaricom appears on the open
 *     statement within a second, receipt code included, with no reload;
 *   - the account document, for the live balance.
 *
 * The summary endpoint is still read once, for `feesEnabled` and the due date.
 * Teachers may read the ledger directly (firestore.rules); every WRITE still
 * goes through the API.
 */

const PAGE = 50;

const toIso = (value) => value?.toDate?.()?.toISOString?.() ?? (typeof value === 'string' ? value : null);

function fromDoc(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    occurredAt: toIso(data.occurredAt),
    recordedAt: toIso(data.recordedAt),
  };
}

export const useStudentFees = ({ session, phone, enabled = false }) => {
  const [summary, setSummary] = useState(null);
  const [account, setAccount] = useState(null);
  const [firstPage, setFirstPage] = useState([]);
  const [olderPages, setOlderPages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [feesEnabled, setFeesEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const { showSuccess, showError } = useToast();
  const lastDocRef = useRef(null);

  // The once-off summary: whether fees are on, and the due date.
  const loadSummary = useCallback(async () => {
    if (!enabled || !session || !phone) return;
    try {
      const result = await getFeeSummary(session, phone);
      setFeesEnabled(result.feesEnabled);
      setSummary(result.summary);
    } catch (error) {
      logger.error('Fee summary load failed', error);
      showError(error?.message ?? 'Could not load fees.');
    }
  }, [enabled, session, phone, showError]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Live ledger + live account.
  useEffect(() => {
    if (!enabled || !phone) return undefined;

    setLoading(true);
    setOlderPages([]);
    let initial = true;

    const ledgerQuery = query(
      collection(db, 'fees', 'accounts', 'items', phone, 'ledger'),
      orderBy('occurredAt', 'desc'),
      limit(PAGE)
    );

    const unsubscribeLedger = onSnapshot(
      ledgerQuery,
      (snap) => {
        setFirstPage(snap.docs.map(fromDoc));
        lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
        setHasMore(snap.docs.length === PAGE);
        setLoading(false);

        // Announce payments that arrive while the statement is open — not the
        // ones that were already there when it opened.
        if (!initial) {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue;
            const entry = fromDoc(change.doc);
            if (entry.type !== 'payment') continue;
            const message = `Payment of ${formatKes(Math.abs(entry.amount))} received${
              entry.reference ? `, receipt ${entry.reference}` : ''
            }.`;
            setAnnouncement(message);
          }
        }
        initial = false;
      },
      (error) => {
        logger.error('Ledger listener failed', error);
        setLoading(false);
      }
    );

    const unsubscribeAccount = onSnapshot(
      doc(db, 'fees', 'accounts', 'items', phone),
      (snap) => setAccount(snap.exists() ? snap.data() : null),
      (error) => logger.error('Account listener failed', error)
    );

    return () => {
      unsubscribeLedger();
      unsubscribeAccount();
    };
  }, [enabled, phone]);

  const loadOlder = useCallback(async () => {
    if (!lastDocRef.current || !phone) return;
    const snap = await getDocs(
      query(
        collection(db, 'fees', 'accounts', 'items', phone, 'ledger'),
        orderBy('occurredAt', 'desc'),
        startAfter(lastDocRef.current),
        limit(PAGE)
      )
    );
    setOlderPages((prev) => [...prev, ...snap.docs.map(fromDoc)]);
    lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current;
    setHasMore(snap.docs.length === PAGE);
  }, [phone]);

  const pay = useCallback(
    async (payload) => {
      setSaving(true);
      try {
        const result = await recordPayment({ session, phone, ...payload });

        // The message states the actual outcome rather than assuming the
        // payment settled the account — a partial payment leaves the student
        // blocked, and the teacher needs to know that now, not later.
        if (result.unblocked) {
          showSuccess('Payment recorded. Balance cleared and the student can rejoin.');
        } else if (result.stillOwes) {
          showSuccess(
            `Payment recorded. KES ${Number(result.balance).toLocaleString('en-KE')} still outstanding.`
          );
        } else {
          showSuccess('Payment recorded.');
        }
        // No reload: the listeners deliver the new entry and balance.
        return { success: true, result };
      } catch (error) {
        logger.error('Record payment failed', error);
        showError(error?.message ?? 'Could not record that payment.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [session, phone, showSuccess, showError]
  );

  const reverse = useCallback(
    async (entryId, note) => {
      setSaving(true);
      try {
        await reverseLedgerEntry({ session, phone, entryId, note });
        showSuccess('Entry reversed. Both the original and the correction stay on the statement.');
        return { success: true };
      } catch (error) {
        logger.error('Reverse entry failed', error);
        showError(error?.message ?? 'Could not reverse that entry.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [session, phone, showSuccess, showError]
  );

  /** Phase 13 / 04 D3: fill in a missing receipt code on a reconciled payment. */
  const addReference = useCallback(
    async (entryId, reference, notMpesa = false) => {
      setSaving(true);
      try {
        await annotateLedgerEntry({ session, phone, entryId, reference, notMpesa });
        showSuccess('Receipt code added.');
        return { success: true };
      } catch (error) {
        logger.error('Add reference failed', error);
        showError(error?.message ?? 'Could not add that receipt code.');
        return { success: false, message: error?.message };
      } finally {
        setSaving(false);
      }
    },
    [session, phone, showSuccess, showError]
  );

  // Live balance wins over the once-off summary.
  const liveSummary = summary
    ? {
        ...summary,
        ...(account
          ? {
              balance: account.balance ?? summary.balance,
              lastPaymentAt: toIso(account.lastPaymentAt) ?? summary.lastPaymentAt,
              lastPaymentAmount: account.lastPaymentAmount ?? summary.lastPaymentAmount,
            }
          : {}),
      }
    : null;

  return {
    summary: liveSummary,
    entries: [...firstPage, ...olderPages],
    hasMore,
    loadOlder,
    feesEnabled,
    loading,
    saving,
    announcement,
    reload: loadSummary,
    pay,
    reverse,
    addReference,
  };
};
