import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { initiatePayment, getPaymentStatus } from '@services/api/payments';
import { formatKes } from '@utils/blockReason';
import logger from '@utils/logger';

/**
 * Student M-Pesa payment — Phase 09 D6.
 *
 * Sits alongside the receipt-resubmission form rather than replacing it: a
 * student without M-Pesa on that handset still needs the manual route, and a
 * parent paying from a different phone is the normal case rather than the
 * exception.
 *
 * The SANDBOX BANNER is unmissable by design. A teacher accidentally live in
 * sandbox sees payments silently vanish — the prompt arrives, the PIN works,
 * and no money moves. Making that state loud is the difference between a
 * five-minute fix and a week of confusion.
 */

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 60_000;

const STAGE_COPY = {
  idle: null,
  initiating: 'Sending the request to M-Pesa…',
  prompted: 'Check your phone and enter your M-Pesa PIN.',
  success: 'Payment received. Thank you.',
  cancelled: 'You cancelled the payment request.',
  timeout: 'The request timed out. You can try again.',
  failed: 'The payment did not go through.',
};

export default function PayNowPanel({ session, phone, balance, onPaid }) {
  const [stage, setStage] = useState('idle');
  const [amount, setAmount] = useState(String(balance ?? ''));
  const [payerPhone, setPayerPhone] = useState(phone ?? '');
  const [message, setMessage] = useState('');
  const [environment, setEnvironment] = useState(null);
  const [checkoutId, setCheckoutId] = useState(null);

  const pollTimer = useRef(null);
  const timeoutTimer = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (timeoutTimer.current) clearTimeout(timeoutTimer.current);
    pollTimer.current = null;
    timeoutTimer.current = null;
  }, []);

  // Timers are cleared on unmount, so navigating away mid-payment does not
  // leave a poll running against a screen that no longer exists.
  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    setAmount(String(balance ?? ''));
  }, [balance]);

  const poll = useCallback(
    async (id) => {
      try {
        const result = await getPaymentStatus(id, phone);

        if (result.status === 'success') {
          stopPolling();
          setStage('success');
          setMessage(
            result.balanceAfter > 0
              ? `Payment received. ${formatKes(result.balanceAfter)} still outstanding.`
              : 'Payment received in full. Your access has been restored.'
          );
          onPaid?.(result);
          return;
        }

        if (['cancelled', 'timeout', 'failed', 'insufficient_funds', 'wrong_pin', 'abandoned']
          .includes(result.status)) {
          stopPolling();
          setStage(result.status === 'cancelled' ? 'cancelled' : 'failed');
          setMessage(result.message ?? STAGE_COPY.failed);
        }
      } catch (error) {
        logger.warn('Payment status poll failed', { code: error?.code });
      }
    },
    [phone, stopPolling, onPaid]
  );

  const handlePay = async () => {
    const payAmount = Number(amount);

    if (!Number.isInteger(payAmount) || payAmount < 1) {
      setMessage('Enter a whole number of shillings.');
      return;
    }
    if (payAmount > balance) {
      setMessage(`That is more than the ${formatKes(balance)} outstanding.`);
      return;
    }

    setStage('initiating');
    setMessage('');

    try {
      const result = await initiatePayment({
        session,
        phone,
        payerPhone: payerPhone.trim() || undefined,
        // Only sent when it differs from the full balance; the server validates
        // it against the real balance regardless.
        payAmount: payAmount === balance ? undefined : payAmount,
      });

      setCheckoutId(result.checkoutRequestId);
      setEnvironment(result.environment);
      setStage('prompted');
      setMessage(result.customerMessage);

      pollTimer.current = setInterval(() => poll(result.checkoutRequestId), POLL_INTERVAL_MS);
      timeoutTimer.current = setTimeout(() => {
        stopPolling();
        setStage('timeout');
        setMessage(STAGE_COPY.timeout);
      }, TIMEOUT_MS);
    } catch (error) {
      logger.error('Payment initiation failed', error);
      setStage('failed');
      setMessage(error?.message ?? 'Could not start the payment. Please try again.');
    }
  };

  const busy = stage === 'initiating' || stage === 'prompted';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border rounded p-3 text-start mb-4"
    >
      <h4 className="h6 fw-bold mb-2">
        <i className="bi bi-phone me-2" aria-hidden="true" />
        Pay with M-Pesa
      </h4>

      {/* Unmissable sandbox warning. */}
      {environment === 'sandbox' && (
        <div className="alert alert-warning py-2 px-3 small mb-3" role="alert">
          <strong>Test mode.</strong> This is a sandbox payment — no real money moves.
        </div>
      )}

      {stage === 'success' ? (
        <div className="alert alert-success mb-0" role="status">
          <i className="bi bi-check-circle-fill me-2" aria-hidden="true" />
          {message}
        </div>
      ) : (
        <>
          <p className="small text-muted">
            Money goes directly to your teacher. You will get an M-Pesa prompt on your
            phone.
          </p>

          <div className="mb-2">
            <label className="form-label small fw-semibold" htmlFor="pay-amount">
              Amount (KES)
            </label>
            <input
              id="pay-amount"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              max={balance}
              className="form-control"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
            <div className="form-text">
              {formatKes(balance)} outstanding. You can pay part of it — your access
              returns once the full amount is cleared.
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-semibold" htmlFor="pay-phone">
              M-Pesa number
            </label>
            <input
              id="pay-phone"
              type="tel"
              className="form-control"
              value={payerPhone}
              onChange={(e) => setPayerPhone(e.target.value)}
              placeholder="+254712345678"
              disabled={busy}
            />
            <div className="form-text">Paying from a different phone? Change it here.</div>
          </div>

          {message && (
            <div
              className={`alert py-2 px-3 small ${
                stage === 'prompted' ? 'alert-info' : stage === 'idle' ? 'alert-danger' : 'alert-warning'
              }`}
              role="status"
              aria-live="polite"
            >
              {message}
            </div>
          )}

          <button
            className="btn btn-success w-100"
            onClick={handlePay}
            disabled={busy || balance <= 0}
          >
            {busy ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                {STAGE_COPY[stage]}
              </>
            ) : stage === 'cancelled' || stage === 'failed' || stage === 'timeout' ? (
              'Try again'
            ) : (
              `Pay ${formatKes(Number(amount) || 0)}`
            )}
          </button>
        </>
      )}
    </motion.div>
  );
}
