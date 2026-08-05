import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import CheckinCard from './CheckinCard';
import RegistrationForm from './RegistrationForm';
import WelcomeBackCard from './WelcomeBackCard';
import BlockedStudentScreen from './BlockedStudentScreen';
import PendingApprovalScreen from './PendingApprovalScreen';
import RejectedScreen from './RejectedScreen';
import SuccessScreen from './SuccessScreen';
import { useRegistration } from '../hooks/useRegistration';
import { useFlag } from '@shared/config/FlagsContext';
import { resolveStudentGate, GATE } from '@utils/studentGate';
import { providerLabel } from '@utils/classLink';

/**
 * One session check-in flow — Phase 04.
 *
 * Replaces the duplicated MorningPage/EveningPage bodies. Routing between
 * screens goes through `resolveStudentGate`, a pure function tested against
 * every combination of approvalStatus and blocked, rather than nested
 * conditionals written twice.
 *
 * Phase 05 drives this from a route slug and a session document; the props are
 * shaped for that already.
 */
export default function SessionPage({ session, label, icon, badgeClass, gradient }) {
  const [step, setStep] = useState('checkin');
  const [phoneNumber, setPhoneNumber] = useState('');

  const requireApproval = useFlag('registration.requireApproval');

  const {
    loading,
    studentData,
    classLink,
    provider,
    countdown,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
    resubmit,
    joinNow,
  } = useRegistration(session);

  /** Single place that maps student state to a screen. */
  const routeTo = useCallback(
    (student) => {
      const { screen } = resolveStudentGate(student, { requireApproval });
      setStep(screen);
      return screen;
    },
    [requireApproval]
  );

  const handleCheckin = async (phone) => {
    setPhoneNumber(phone);
    const { exists, data } = await checkStudent(phone);

    if (!exists) {
      setStep(GATE.REGISTER);
      return;
    }

    const screen = routeTo(data);
    // Only an approved, unblocked student goes anywhere near the class link.
    if (screen === GATE.WELCOME) return;
  };

  const handleRegistration = async (formData) => {
    const result = await register(phoneNumber, formData);
    if (!result.success) return;

    // Route on the record that was actually written, not on an assumption.
    // With approval on, a new registration goes to the pending screen and the
    // class link is never requested.
    const screen = routeTo(result.student);
    if (screen === GATE.WELCOME) {
      setStep('redirect');
      await redirectToZoom();
    }
  };

  const handleRedirect = async () => {
    setStep('redirect');
    const result = await redirectToZoom();
    if (!result.success) {
      // The server refused. Re-check so the screen reflects the real reason
      // rather than leaving the student on a spinner.
      const { data } = await checkStudent(phoneNumber);
      routeTo(data);
    }
  };

  const handleRefresh = async () => {
    const { exists, data } = await checkStudent(phoneNumber);
    if (!exists) {
      setStep(GATE.REGISTER);
      return;
    }
    routeTo(data);
  };

  const handleSubmitReceipt = async (receiptMessage) => {
    await submitReceipt(receiptMessage);
  };

  const handleResubmit = async (details) => {
    const result = await resubmit(details);
    if (result.success) setStep(GATE.PENDING);
    return result;
  };

  const handleBack = () => {
    setStep('checkin');
    setPhoneNumber('');
  };

  return (
    <div className="hero-section" style={{ background: gradient }}>
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center py-5">
          <div className="col-lg-6 col-md-8">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-center"
            >
              <Link to="/" className="text-white text-decoration-none">
                <i className="bi bi-arrow-left me-2" aria-hidden="true" />
                Back to Home
              </Link>
            </motion.div>

            <div className="text-center mb-4 animate-fade-in-up">
              <div className={`session-badge ${badgeClass} d-inline-flex`}>
                <i className={`bi ${icon} me-2`} aria-hidden="true" />
                {label}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {step === 'checkin' && (
                <CheckinCard
                  key="checkin"
                  session={session}
                  onSubmit={handleCheckin}
                  loading={loading}
                />
              )}

              {step === GATE.REGISTER && (
                <RegistrationForm
                  key="register"
                  session={session}
                  phoneNumber={phoneNumber}
                  onSubmit={handleRegistration}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === GATE.PENDING && (
                <PendingApprovalScreen
                  key="pending"
                  session={session}
                  studentData={studentData}
                  onRefresh={handleRefresh}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === GATE.REJECTED && (
                <RejectedScreen
                  key="rejected"
                  session={session}
                  studentData={studentData}
                  onResubmit={handleResubmit}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === GATE.BLOCKED && studentData && (
                <BlockedStudentScreen
                  key="blocked"
                  session={session}
                  studentData={studentData}
                  onSubmitReceipt={handleSubmitReceipt}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === GATE.WELCOME && studentData && (
                <WelcomeBackCard
                  key="welcome"
                  session={session}
                  studentData={studentData}
                  onJoinNow={handleRedirect}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === 'redirect' && (
                <SuccessScreen
                  key="redirect"
                  title={`Opening ${providerLabel(provider)}… 🎓`}
                  message={
                    classLink
                      ? "If it doesn't open automatically, use the button below."
                      : 'Getting your class link…'
                  }
                  zoomLink={classLink}
                  provider={provider}
                  countdown={countdown ?? undefined}
                  onJoinNow={classLink ? joinNow : undefined}
                  showSpinner={!classLink}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
