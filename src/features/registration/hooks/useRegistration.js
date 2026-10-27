import { useState, useCallback, useEffect, useRef } from 'react';
import { registerStudentApi } from '@services/api/public';
import {
  checkinStudent,
  submitReceipt as submitReceiptApi,
  getClassLink,
  resubmitRegistration,
} from '@services/api/student';
import { ApiError } from '@services/api/client';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackRegistration, trackZoomRedirect } from '@utils/analytics';
import { reportApiFailure } from '@utils/monitoring';

/**
 * Registration and check-in.
 *
 * Phase 01 moved reads and the class-link fetch to serverless handlers.
 * Phase 04 adds the approval-aware flow and replaces the silent redirect with
 * a visible, cancellable countdown.
 *
 * Registration goes through /api/student/register since Phase 13 / 08 A1. It
 * was a direct Firestore write — the one reason a student's phone downloaded
 * the Firebase SDK — and is now validated on the server too.
 */

const REDIRECT_SECONDS = 3;

/**
 * A number the API could accept — the server's own E.164 rule
 * (api/_lib/validate.js phoneSchema, before its trunk-zero refinement).
 * Anything else is never sent: the server would only refuse it.
 */
export const isUsablePhone = (phone) => /^\+[1-9]\d{7,18}$/.test(String(phone ?? '').trim());

/**
 * What a call returns when the student has left the flow it belonged to
 * ("Use a different number" while it was in flight) — 002Fixes / 03. The
 * caller drops it: no screen change, no data written, no follow-on request.
 */
export const STALE = Object.freeze({ stale: true, exists: false, data: null, success: false });

/** What a call returns when there is no usable number: the flow starts over. */
export const RESTART = Object.freeze({ restart: true, exists: false, data: null, success: false });

export const useRegistration = (session) => {
  const [loading, setLoading] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [isReturningStudent, setIsReturningStudent] = useState(false);
  // The number this check-in flow is about — the ONE copy (002Fixes / 03).
  // SessionPage used to keep a second one, and only that one was cleared.
  const [phoneNumber, setPhoneNumber] = useState('');
  const [classLink, setClassLink] = useState('');
  const [provider, setProvider] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const { showError, showSuccess } = useToast();

  /**
   * The redirect timer.
   *
   * Previously a bare `setTimeout(() => { window.location.href = link }, 2000)`
   * with no cleanup: navigating away mid-countdown left a pending timer that
   * then reassigned window.location out from under whatever screen the student
   * had moved to. Held in a ref and cleared on unmount.
   */
  const intervalRef = useRef(null);
  const targetRef = useRef('');

  const clearRedirect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clearRedirect, [clearRedirect]);

  const goNow = useCallback(() => {
    clearRedirect();
    if (targetRef.current) window.location.href = targetRef.current;
  }, [clearRedirect]);

  /**
   * The check-in flow generation — 002Fixes / 03.
   *
   * On 26 Oct "Use a different number", pressed while a "Check again" was in
   * flight, cleared the number; the late reply then put the waiting screen
   * back with no number, and every later "Check again" sent phone "". Every
   * call now notes the generation it started in, and a reply that arrives
   * after `resetFlow()` is dropped (STALE) instead of acted on.
   */
  const flowRef = useRef(0);
  const currentFlow = useCallback(() => flowRef.current, []);

  /**
   * The check-in pass — 002Fixes / 07. Handed back by a check-in that found
   * the student (or by registering); repeat checks and the class link carry
   * it so they are not counted against the rate limits. Kept in MEMORY only
   * (never web storage, per the client's token policy) and only ever sent for
   * the number it was issued for.
   */
  const passRef = useRef(null);
  const passFor = (phone) => (passRef.current?.phone === phone ? passRef.current.pass : undefined);
  const keepPass = (phone, pass) => { if (pass) passRef.current = { phone, pass }; };

  /** Leave the current flow: drop its pending replies, forget its number. */
  const resetFlow = useCallback(() => {
    flowRef.current += 1;
    passRef.current = null;
    clearRedirect();
    setPhoneNumber('');
    setStudentData(null);
    setIsReturningStudent(false);
    setLoading(false);
  }, [clearRedirect]);

  /** No usable number: tell the student, report it, send nothing. */
  const refuseUnusable = useCallback((action, path) => {
    reportApiFailure(new ApiError('No usable phone number for this request.', { code: 'client_empty_phone', path }), {
      action, screen: 'guard',
    });
    showError('Please enter your phone number again.');
    return RESTART;
  }, [showError]);

  const checkStudent = useCallback(async (phone) => {
    if (!isUsablePhone(phone)) return refuseUnusable('checkin', '/api/student/checkin');
    const flow = flowRef.current;
    setLoading(true);
    setPhoneNumber(phone);
    try {
      const { exists, student, pass } = await checkinStudent(session, phone, passFor(phone));
      if (flow !== flowRef.current) return STALE;
      keepPass(phone, pass);

      if (exists) {
        setStudentData(student);
        setIsReturningStudent(true);
      } else {
        setStudentData(null);
        setIsReturningStudent(false);
      }

      return { exists, data: student };
    } catch (error) {
      if (flow !== flowRef.current) return STALE;
      logger.error('Check student failed', error);
      // A refusal for checking too often gets its own notice with the real
      // wait (SessionPage, 002Fixes / 05), not "please wait a moment".
      if (error?.status !== 429) showError(error?.message || 'Unable to check registration. Please try again.');
      throw error;
    } finally {
      if (flow === flowRef.current) setLoading(false);
    }
  }, [session, showError, refuseUnusable]);

  const register = useCallback(async (phone, formData) => {
    if (!isUsablePhone(phone)) return refuseUnusable('register', '/api/student/register');
    const flow = flowRef.current;
    setLoading(true);
    try {
      // The response carries the created record (the same projection as
      // check-in), so the caller routes on the real approval state without a
      // second request.
      const { student, pass } = await registerStudentApi({ session, phone, ...formData });
      // Registered either way; but if the student has left this flow, the
      // screens must not move on its account.
      if (flow !== flowRef.current) return STALE;
      keepPass(phone, pass);
      trackRegistration(session);
      showSuccess('Registration successful!');
      setStudentData(student);

      return { success: true, student };
    } catch (error) {
      if (flow !== flowRef.current) return STALE;
      logger.error('Registration failed', error);

      if (error.code === 'already_registered' || error.code === 'permission-denied') {
        showError('Registration failed. You may already be registered.');
      } else if (error.status === 400) {
        showError(error.message || 'Please check the form and try again.');
      } else if (error.code === 'unavailable' || error.code === 'network_error' || error.code === 'timeout') {
        showError('Connection error. Please check your internet.');
      } else {
        showError('Registration failed. Please try again.');
      }

      return { success: false, error };
    } finally {
      if (flow === flowRef.current) setLoading(false);
    }
  }, [session, showSuccess, showError, refuseUnusable]);

  /**
   * Requests the class link and starts a visible countdown.
   *
   * Entitlement is decided entirely on the server. A refusal arrives as an
   * ApiError whose `code` says why — blocked, approval_pending,
   * registration_rejected, service_unavailable — so the UI renders the real
   * reason rather than a generic failure.
   */
  const redirectToZoom = useCallback(async () => {
    if (!isUsablePhone(phoneNumber)) return refuseUnusable('join', '/api/class/link');
    const flow = flowRef.current;
    try {
      const { url, provider: linkProvider } = await getClassLink(session, phoneNumber, passFor(phoneNumber));
      // Never start the countdown into class for a flow the student has left.
      if (flow !== flowRef.current) return STALE;

      trackZoomRedirect(session);

      setClassLink(url);
      setProvider(linkProvider);
      targetRef.current = url;

      clearRedirect();
      setCountdown(REDIRECT_SECONDS);

      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            clearRedirect();
            window.location.href = targetRef.current;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return { success: true, zoomLink: url, provider: linkProvider };
    } catch (error) {
      if (flow !== flowRef.current) return STALE;
      logger.error('Class link request failed', error);
      if (error?.status !== 429) showError(error?.message || 'Unable to join class. Please contact your teacher.');
      return { success: false, code: error?.code, status: error?.status, retryAfter: error?.retryAfter, error };
    }
  }, [session, phoneNumber, showError, clearRedirect, refuseUnusable]);

  const submitReceipt = useCallback(async (receiptMessage) => {
    if (!isUsablePhone(phoneNumber)) return refuseUnusable('receipt', '/api/student/receipt');
    const flow = flowRef.current;
    setLoading(true);
    try {
      await submitReceiptApi(session, phoneNumber, receiptMessage);
      if (flow !== flowRef.current) return STALE;
      showSuccess('Payment receipt submitted successfully! Awaiting teacher approval.');

      const { student } = await checkinStudent(session, phoneNumber, passFor(phoneNumber));
      if (flow !== flowRef.current) return STALE;
      setStudentData(student);

      return { success: true };
    } catch (error) {
      if (flow !== flowRef.current) return STALE;
      logger.error('Submit receipt failed', error);
      showError(error?.message || 'Failed to submit receipt. Please try again.');
      return { success: false, error };
    } finally {
      if (flow === flowRef.current) setLoading(false);
    }
  }, [session, phoneNumber, showSuccess, showError, refuseUnusable]);

  /** Resubmission after a rejection — Phase 04 Part A. */
  const resubmit = useCallback(async (details) => {
    if (!isUsablePhone(phoneNumber)) return refuseUnusable('resubmit', '/api/student/resubmit');
    const flow = flowRef.current;
    setLoading(true);
    try {
      await resubmitRegistration(session, phoneNumber, details);
      if (flow !== flowRef.current) return STALE;
      showSuccess('Sent. Your teacher will review it shortly.');

      const { student } = await checkinStudent(session, phoneNumber, passFor(phoneNumber));
      if (flow !== flowRef.current) return STALE;
      setStudentData(student);

      return { success: true };
    } catch (error) {
      if (flow !== flowRef.current) return STALE;
      logger.error('Resubmit failed', error);
      showError(error?.message || 'Could not resubmit. Please try again.');
      return { success: false, message: error?.message, code: error?.code };
    } finally {
      if (flow === flowRef.current) setLoading(false);
    }
  }, [session, phoneNumber, showSuccess, showError, refuseUnusable]);

  return {
    loading,
    studentData,
    isReturningStudent,
    phoneNumber,
    resetFlow,
    currentFlow,
    classLink,
    provider,
    countdown,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
    resubmit,
    joinNow: goNow,
  };
};
