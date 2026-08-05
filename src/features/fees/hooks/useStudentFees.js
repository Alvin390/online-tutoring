import { useState, useEffect, useCallback } from 'react';
import { getFeeSummary, recordPayment, reverseLedgerEntry } from '@services/api/fees';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';

/**
 * One student's fee state — Phase 06.
 *
 * Loaded only when the drawer's Fees tab is opened, like notes. Ledger entries
 * are never part of the dashboard's initial payload.
 */
export const useStudentFees = ({ session, phone, enabled = false }) => {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [feesEnabled, setFeesEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  const load = useCallback(async () => {
    if (!enabled || !session || !phone) return;

    setLoading(true);
    try {
      const result = await getFeeSummary(session, phone);
      setFeesEnabled(result.feesEnabled);
      setSummary(result.summary);
      setEntries(result.entries ?? []);
    } catch (error) {
      logger.error('Fee summary load failed', error);
      showError(error?.message ?? 'Could not load fees.');
    } finally {
      setLoading(false);
    }
  }, [enabled, session, phone, showError]);

  useEffect(() => {
    load();
  }, [load]);

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

        await load();
        return { success: true, result };
      } catch (error) {
        logger.error('Record payment failed', error);
        showError(error?.message ?? 'Could not record that payment.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [session, phone, load, showSuccess, showError]
  );

  const reverse = useCallback(
    async (entryId, note) => {
      setSaving(true);
      try {
        await reverseLedgerEntry({ session, phone, entryId, note });
        showSuccess('Entry reversed. Both the original and the correction stay on the statement.');
        await load();
        return { success: true };
      } catch (error) {
        logger.error('Reverse entry failed', error);
        showError(error?.message ?? 'Could not reverse that entry.');
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [session, phone, load, showSuccess, showError]
  );

  return { summary, entries, feesEnabled, loading, saving, reload: load, pay, reverse };
};
