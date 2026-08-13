import { useState, useCallback, useEffect, useRef } from 'react';
import { registerStudent } from '@services/firebase/firestore';
import {
  checkinStudent,
  submitReceipt as submitReceiptApi,
  getClassLink,
  resubmitRegistration,
} from '@services/api/student';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackRegistration, trackZoomRedirect } from '@utils/analytics';

/**
 * Registration and check-in.
 *
 * Phase 01 moved reads and the class-link fetch to serverless handlers.
 * Phase 04 adds the approval-aware flow and replaces the silent redirect with
 * a visible, cancellable countdown.
 *
 * `registerStudent` stays a direct Firestore write: registration is the one
 * operation that precedes identity, and firestore.rules constrains its shape
 * tightly enough to be safe from an unauthenticated caller.
 */

const REDIRECT_SECONDS = 3;

export const useRegistration = (session) => {
  const [loading, setLoading] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [isReturningStudent, setIsReturningStudent] = useState(false);
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
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

  const checkStudent = useCallback(async (phoneNumber) => {
    setLoading(true);
    setCurrentPhoneNumber(phoneNumber);
    try {
      const { exists, student } = await checkinStudent(session, phoneNumber);

      if (exists) {
        setStudentData(student);
        setIsReturningStudent(true);
      } else {
        setStudentData(null);
        setIsReturningStudent(false);
      }

      return { exists, data: student };
    } catch (error) {
      logger.error('Check student failed', error);
      showError(error?.message || 'Unable to check registration. Please try again.');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [session, showError]);

  const register = useCallback(async (phoneNumber, formData) => {
    setLoading(true);
    try {
      await registerStudent(session, phoneNumber, formData);
      trackRegistration(session);
      showSuccess('Registration successful!');

      // Read back the created record so the caller can route on the real
      // approval state rather than assuming it.
      const { student } = await checkinStudent(session, phoneNumber);
      setStudentData(student);

      return { success: true, student };
    } catch (error) {
      logger.error('Registration failed', error);

      if (error.code === 'permission-denied') {
        showError('Registration failed. You may already be registered.');
      } else if (error.code === 'unavailable') {
        showError('Connection error. Please check your internet.');
      } else {
        showError('Registration failed. Please try again.');
      }

      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, [session, showSuccess, showError]);

  /**
   * Requests the class link and starts a visible countdown.
   *
   * Entitlement is decided entirely on the server. A refusal arrives as an
   * ApiError whose `code` says why — blocked, approval_pending,
   * registration_rejected, service_unavailable — so the UI renders the real
   * reason rather than a generic failure.
   */
  const redirectToZoom = useCallback(async () => {
    try {
      const { url, provider: linkProvider } = await getClassLink(session, currentPhoneNumber);

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
      logger.error('Class link request failed', error);
      showError(error?.message || 'Unable to join class. Please contact your teacher.');
      return { success: false, code: error?.code };
    }
  }, [session, currentPhoneNumber, showError, clearRedirect]);

  const submitReceipt = useCallback(async (receiptMessage) => {
    setLoading(true);
    try {
      await submitReceiptApi(session, currentPhoneNumber, receiptMessage);
      showSuccess('Payment receipt submitted successfully! Awaiting teacher approval.');

      const { student } = await checkinStudent(session, currentPhoneNumber);
      setStudentData(student);

      return { success: true };
    } catch (error) {
      logger.error('Submit receipt failed', error);
      showError(error?.message || 'Failed to submit receipt. Please try again.');
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  }, [session, currentPhoneNumber, showSuccess, showError]);

  /** Resubmission after a rejection — Phase 04 Part A. */
  const resubmit = useCallback(async (details) => {
    setLoading(true);
    try {
      await resubmitRegistration(session, currentPhoneNumber, details);
      showSuccess('Sent. Your teacher will review it shortly.');

      const { student } = await checkinStudent(session, currentPhoneNumber);
      setStudentData(student);

      return { success: true };
    } catch (error) {
      logger.error('Resubmit failed', error);
      showError(error?.message || 'Could not resubmit. Please try again.');
      return { success: false, message: error?.message, code: error?.code };
    } finally {
      setLoading(false);
    }
  }, [session, currentPhoneNumber, showSuccess, showError]);

  return {
    loading,
    studentData,
    isReturningStudent,
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
