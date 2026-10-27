import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import CheckinCard from './CheckinCard';
import WelcomeBackCard from './WelcomeBackCard';
import BlockedStudentScreen from './BlockedStudentScreen';
import PendingApprovalScreen from './PendingApprovalScreen';
import RejectedScreen from './RejectedScreen';
import SuccessScreen from './SuccessScreen';
import { useRegistration } from '../hooks/useRegistration';
import { useFlag } from '@shared/config/FlagsContext';
import { resolveStudentGate, GATE } from '@utils/studentGate';
import { providerLabel } from '@utils/classLink';
import { formatSchedule } from '@utils/formatSchedule';
import { addFlowBreadcrumb } from '@utils/monitoring';

// Phase 13 / 08: the registration form (react-hook-form + zod, ~20 KB gz) is
// only needed by a first-time student, after the phone lookup. Loaded on
// demand, and prefetched as soon as a number is submitted (A5), so it is
// normally ready before the lookup answers.
const loadRegistrationForm = () => import('./RegistrationForm');
const RegistrationForm = lazy(loadRegistrationForm);
import '@/styles/landing.css';

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
// After a payment clears the balance: how long the success message stays up,
// and how often / how many times the student's access is re-checked.
export const PAID_REDIRECT_DELAY_MS = 2000;
const PAID_RECHECK_INTERVAL_MS = 1500;
const PAID_RECHECKS = 3;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * What a breadcrumb may say about the number a request is about to use —
 * 002Fixes / 01. Its length and whether it is empty, never the digits: on
 * 26 Oct an emptied number was the whole story, and this shows it directly.
 */
const numberShape = (value) => ({ numberLength: String(value ?? '').length, numberEmpty: !value });

export default function SessionPage({ session, label, icon, gradient, schedule = null, description = '', classes, subjectsByClass }) {
  const timeLine = formatSchedule(schedule);
  const [step, setStep] = useState('checkin');

  const requireApproval = useFlag('registration.requireApproval');

  const {
    loading,
    studentData,
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

  // Every screen change, as a breadcrumb for the next error report.
  useEffect(() => {
    addFlowBreadcrumb('screen', { screen: step });
  }, [step]);

  /** Back to an empty check-in card; any reply still in flight is dropped. */
  const startOver = useCallback(() => {
    resetFlow();
    setStep('checkin');
  }, [resetFlow]);

  /**
   * One rule for every reply — 002Fixes / 03. A reply from a flow the student
   * has left (STALE) changes nothing; no usable number (RESTART) means start
   * over at the check-in card. Returns null in both cases.
   */
  const settle = (result) => {
    if (result?.stale) return null;
    if (result?.restart) {
      startOver();
      return null;
    }
    return result;
  };

  const handleCheckin = async (phone) => {
    addFlowBreadcrumb('action', { action: 'checkin', ...numberShape(phone) });
    loadRegistrationForm().catch(() => {}); // prefetch; a failure retries on render
    const result = settle(await checkStudent(phone));
    if (!result) return;

    if (!result.exists) {
      setStep(GATE.REGISTER);
      return;
    }

    // Only an approved, unblocked student goes anywhere near the class link.
    routeTo(result.data);
  };

  const handleRegistration = async (formData) => {
    addFlowBreadcrumb('action', { action: 'register', ...numberShape(phoneNumber) });
    const result = settle(await register(phoneNumber, formData));
    if (!result?.success) return;

    // Route on the record that was actually written, not on an assumption.
    // With approval on, a new registration goes to the pending screen and the
    // class link is never requested.
    const screen = routeTo(result.student);
    if (screen === GATE.WELCOME) {
      setStep('redirect');
      settle(await redirectToZoom());
    }
  };

  const handleRedirect = async () => {
    addFlowBreadcrumb('action', { action: 'join', ...numberShape(phoneNumber) });
    setStep('redirect');
    const result = settle(await redirectToZoom());
    if (result && !result.success) {
      // The server refused. Re-check so the screen reflects the real reason
      // rather than leaving the student on a spinner.
      const check = settle(await checkStudent(phoneNumber));
      if (check) routeTo(check.data);
    }
  };

  const handleRefresh = async () => {
    addFlowBreadcrumb('action', { action: 'refresh', ...numberShape(phoneNumber) });
    const result = settle(await checkStudent(phoneNumber));
    if (!result) return;
    if (!result.exists) {
      setStep(GATE.REGISTER);
      return;
    }
    routeTo(result.data);
  };

  /**
   * M-Pesa paid from the blocked screen. A payment that clears the balance
   * takes the student straight to class: the success message stays up for a
   * moment, then the student is re-checked and, once admitted, redirected.
   *
   * Re-checked rather than assumed: a teacher's own block (with a reason)
   * still stands after paying, and the screen must show it. A short retry
   * covers the unblock landing a beat after the payment status.
   */
  const handlePaid = async (result) => {
    if (Number(result?.balanceAfter) > 0) return; // partial payment: still blocked
    addFlowBreadcrumb('action', { action: 'paid', ...numberShape(phoneNumber) });
    // The loop waits between checks; leaving the screen stops it (002Fixes / 03).
    const flow = currentFlow();
    await wait(PAID_REDIRECT_DELAY_MS);
    for (let attempt = 0; attempt < PAID_RECHECKS; attempt += 1) {
      if (flow !== currentFlow()) return;
      const result = settle(await checkStudent(phoneNumber));
      if (!result) return;
      if (!result.exists) {
        setStep(GATE.REGISTER);
        return;
      }
      const { screen } = resolveStudentGate(result.data, { requireApproval });
      if (screen === GATE.WELCOME) {
        setStep(screen);
        await handleRedirect();
        return;
      }
      if (screen !== GATE.BLOCKED || attempt === PAID_RECHECKS - 1) {
        setStep(screen);
        return;
      }
      await wait(PAID_RECHECK_INTERVAL_MS);
    }
  };

  const handleSubmitReceipt = async (receiptMessage) => {
    settle(await submitReceipt(receiptMessage));
  };

  const handleResubmit = async (details) => {
    const result = await resubmit(details);
    if (settle(result)?.success) setStep(GATE.PENDING);
    return result;
  };

  const handleBack = () => {
    addFlowBreadcrumb('action', { action: 'back' });
    startOver();
  };

  return (
    <div className="hero-section" style={{ background: gradient }}>
      <div className="hero-overlay" />

      <div className="container position-relative">
        <div className="row min-vh-100 align-items-center justify-content-center py-5">
          <div className="col-lg-6 col-md-8">
            <m.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-center"
            >
              <Link to="/" className="text-white text-decoration-none">
                <i className="bi bi-arrow-left me-2" aria-hidden="true" />
                Back to Home
              </Link>
            </m.div>

            <div className="text-center mb-4 animate-fade-in-up">
              <div className="session-badge" style={{ '--card-gradient': gradient }}>
                <i className={`bi ${icon} me-2`} aria-hidden="true" />
                {label}
              </div>
              {/* Phase 13 / 02 D5: the same details as the homepage card. */}
              {(timeLine || description) && (
                <div className="session-page-details mt-2 small">
                  {timeLine && (
                    <div>
                      <i className="bi bi-clock-fill me-1" aria-hidden="true" />
                      {timeLine}
                    </div>
                  )}
                  {description && <div className="mt-1">{description}</div>}
                </div>
              )}
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
                <Suspense
                  key="register"
                  fallback={(
                    <div className="text-center py-4">
                      <span className="spinner-border spinner-border-sm text-primary" role="status">
                        <span className="visually-hidden">Loading the registration form…</span>
                      </span>
                    </div>
                  )}
                >
                  <RegistrationForm
                    session={session}
                    classes={classes}
                    subjectsByClass={subjectsByClass}
                    phoneNumber={phoneNumber}
                    onSubmit={handleRegistration}
                    onBack={handleBack}
                    loading={loading}
                  />
                </Suspense>
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
                  classes={classes}
                  subjectsByClass={subjectsByClass}
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
                  // The phone comes from here, not from studentData.
                  // api/student/checkin.js:45 projects a deliberately minimal
                  // record over the wire and does not include it, so reading
                  // it off studentData yielded undefined and every STK push
                  // failed validation before it reached Daraja. This is the
                  // number the student just typed to check in.
                  phoneNumber={phoneNumber}
                  onSubmitReceipt={handleSubmitReceipt}
                  onPaid={handlePaid}
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
