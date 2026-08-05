import { useState, useCallback, useEffect, useRef } from 'react';
import { registerStudent } from '@services/firebase/firestore';
import { checkinStudent, submitReceipt as submitReceiptApi, getClassLink } from '@services/api/student';
import { useToast } from '@/context/ToastContext';
import logger from '@utils/logger';
import { trackRegistration, trackZoomRedirect } from '@utils/analytics';

/**
 * Registration and check-in — Phase 01 rewiring.
 *
 * Reads and the class-link fetch now go through serverless handlers.
 * `registerStudent` stays a direct Firestore write: registration is the one
 * operation that precedes identity, and `firestore.rules` constrains its shape
 * tightly enough to be safe from an unauthenticated caller.
 */

const REDIRECT_DELAY_MS = 2000;

export const useRegistration = (session) => {
  const [loading, setLoading] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [isReturningStudent, setIsReturningStudent] = useState(false);
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
  const { showError, showSuccess } = useToast();

  // The redirect timer used to be a bare setTimeout with no cleanup, so
  // navigating away mid-countdown left a pending timer that then reassigned
  // window.location out from under the new screen.
  const redirectTimer = useRef(null);
  useEffect(() => () => {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
  }, []);

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

      // `data` is kept in the return shape for the existing page components.
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
      return { success: true };
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
   * Fetches the class link and navigates.
   *
   * The server decides entitlement; this only renders the outcome. A refusal
   * arrives as an ApiError whose `code` says why, so a blocked student sees the
   * teacher's actual reason rather than a generic failure.
   */
  const redirectToZoom = useCallback(async () => {
    try {
      const { url, provider } = await getClassLink(session, currentPhoneNumber);

      trackZoomRedirect(session);

      if (redirectTimer.current) clearTimeout(redirectTimer.current);
      redirectTimer.current = setTimeout(() => {
        window.location.href = url;
      }, REDIRECT_DELAY_MS);

      return { success: true, zoomLink: url, provider };
    } catch (error) {
      logger.error('Class link request failed', error);
      showError(error?.message || 'Unable to join class. Please contact your teacher.');
      return { success: false, code: error?.code };
    }
  }, [session, currentPhoneNumber, showError]);

  const submitReceipt = useCallback(async (receiptMessage) => {
    setLoading(true);
    try {
      await submitReceiptApi(session, currentPhoneNumber, receiptMessage);
      showSuccess('Payment receipt submitted successfully! Awaiting teacher approval.');

      // Refresh so the blocked screen reflects the pending state.
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

  return {
    loading,
    studentData,
    isReturningStudent,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
  };
};
