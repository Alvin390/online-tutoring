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
import { retiredMessage } from '@utils/retiredMessage';
import { providerLabel } from '@utils/classLink';
import { formatSchedule, formatTime } from '@utils/formatSchedule';
import { addFlowBreadcrumb, reportApiFailure } from '@utils/monitoring';
import { useRetryWait } from '../hooks/useRetryWait';
import RetryWaitNotice from './RetryWaitNotice';

// Phase 13 / 08: the registration form (react-hook-form + zod, ~20 KB gz) is
// only needed by a first-time student, after the phone lookup. Loaded on
// demand, and prefetched as soon as a number is submitted (A5), so it is
// normally ready before the lookup answers.
const loadRegistrationForm = () => import('./RegistrationForm');
const RegistrationForm = lazy(loadRegistrationForm);
// 008Fixes / 04: the registration code step and "registered before with a
// different number" (009Fixes) — loaded only when a student reaches them.
// (014Fixes / 04: the check-in first-time steps moved to ./numbers.)
const loadAdmissionSteps = () => import('./AdmissionSteps');
// 009Fixes / 01 and 03: the code before registering, and "registered before
// with a different number" — the same lazy chunk.
const RegisterCodeStep = lazy(() => loadAdmissionSteps().then((mod) => ({ default: mod.RegisterCodeStep })));
const FixNumberByName = lazy(() => loadAdmissionSteps().then((mod) => ({ default: mod.FixNumberByName })));
// 014Fixes: the admission-number steps (type your number; confirm the phone;
// the number given) — one lazy chunk, prefetched when a phone is submitted.
const loadNumberSteps = () => import('./numbers');
const NumberStep = lazy(() => loadNumberSteps().then((mod) => ({ default: mod.NumberStep })));
const FirstTimeFlow = lazy(() => loadNumberSteps().then((mod) => ({ default: mod.FirstTimeFlow })));
/** 014Fixes / 03: refusals of a typed admission number, shown on the number step. */
const NUMBER_REFUSALS = Object.freeze(['number_mismatch', 'other_device', 'duplicate_records', 'invalid_number']);
const stepFallback = (
  <div className="text-center py-4">
    <span className="spinner-border spinner-border-sm text-primary" role="status">
      <span className="visually-hidden">Loading…</span>
    </span>
  </div>
);
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
  const classTime = formatTime(schedule?.startTime);
  const [step, setStep] = useState('checkin');
  // Whether this flow has already tried to join; the welcome card then stops
  // counting down by itself (002Fixes / 05).
  const [joinTried, setJoinTried] = useState(false);
  const { until: waitUntil, secondsLeft: waitSeconds, startWait } = useRetryWait(session);

  const requireApproval = useFlag('registration.requireApproval');
  // 008Fixes / 04: admission number + phone. The server has the last word: a
  // page whose flags are stale still follows what the check-in answers.
  const numbersFlag = useFlag('checkin.admissionNumbers');
  const [numbersSeen, setNumbersSeen] = useState(false);
  const numbers = numbersFlag || numbersSeen;
  // 009Fixes: code-first registration and the one-time number fix.
  const fixFlag = useFlag('student.fixNumber');
  // 010Fixes / 01: the server asked for the code first though this page's
  // switches said otherwise (they were a few minutes old): code-first from now on.
  const [codeFirstSeen, setCodeFirstSeen] = useState(false);
  const fixOn = numbers && (fixFlag || codeFirstSeen);
  // The form waiting for its code (kept, so a failed save keeps the typing),
  // and the confirmed phone's ticket (valid 30 minutes: a retry needs no new code).
  const [pendingForm, setPendingForm] = useState(null);
  const [regTicket, setRegTicket] = useState(null);
  // What the check-in card shows next time: a notice, the phone refilled.
  // `key` remounts the card so the refill takes.
  const [cardView, setCardView] = useState({ key: 0, notice: null, initialPhone: '' });
  // 014Fixes / 03: the last refusal of a typed admission number (a new object
  // each time, so the step shows it again after the student typed).
  const [numberRefusal, setNumberRefusal] = useState(null);
  // 014Fixes / 05: which first-time answer sent the student to confirm their
  // phone. Only a phone never confirmed may move to a different number.
  const [firstTimeFrom, setFirstTimeFrom] = useState(null);


  const {
    loading,
    studentData,
    phoneNumber,
    resetFlow,
    currentFlow,
    classLink,
    provider,
    countdown,
    slow,
    failedSlow,
    checkStudent,
    register,
    redirectToZoom,
    submitReceipt,
    resubmit,
    joinNow,
  } = useRegistration(session);

  /** Single place that maps student state to a screen. */
  // 003Fixes / 12: why this number can't be used, when the teacher retired it.
  const [retired, setRetired] = useState(null);
  /** Not registered: the form — or, for a retired number, what to do instead. */
  const notRegistered = (result) => {
    if (result.retired) {
      setRetired({ reason: result.retired, keptSuffix: result.keptSuffix ?? null });
      setStep('retired');
      return;
    }
    setStep(GATE.REGISTER);
  };

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
    setJoinTried(false);
    setPendingForm(null);
    setRegTicket(null);
    setNumberRefusal(null);
    setCardView((v) => ({ key: v.key + 1, notice: null, initialPhone: '' }));
    setStep('checkin');
  }, [resetFlow]);

  /** Back to the check-in card with something to say, the phone refilled. */
  const backToCard = (notice, phone = phoneNumber) => {
    setNumberRefusal(null);
    setCardView((v) => ({ key: v.key + 1, notice, initialPhone: phone }));
    setStep('checkin');
  };

  /** 009Fixes / 03: the record moved to the real number — check in with it. */
  const numberFixed = (newPhone, notice) => {
    setNumbersSeen(true);
    backToCard(notice, newPhone);
  };

  /**
   * 008Fixes / 04: a check-in that answered with an admission-number step or
   * refusal (useRegistration ADMISSION_CODES). Steps lead on; refusals go
   * back to the card with the server's own words.
   */
  const followAdmission = (result) => {
    setNumbersSeen(true);
    // Confirm the phone (a confirmed record without a number gets a code
    // again: choosing needs the ticket a confirmed code gives).
    if (result.admission === 'verify_required' || result.admission === 'choose_number') {
      setFirstTimeFrom(result.admission);
      setStep('admission');
      return;
    }
    // 014Fixes / 03: has a number — the next step asks for it. A refused
    // number (wrong, another device, duplicates) is said on that step.
    if (result.admission === 'number_required') {
      setNumberRefusal(null);
      setStep('number');
      return;
    }
    if (NUMBER_REFUSALS.includes(result.admission)) {
      setNumberRefusal({ code: result.admission, message: result.message });
      setStep('number');
      return;
    }
    backToCard({ tone: 'error', text: result.message });
  };

  /**
   * Every student action, handled — 002Fixes / 05.
   *
   * These used to throw out of the click handler, so a failed check-in was an
   * unhandled rejection: the student got a toast and a dead screen, and Sentry
   * saw it only by accident. Now the failure is caught, reported on purpose
   * (warning level, with what was being done and where), and a refusal for
   * checking too often starts a visible wait with the server's real time.
   * The hook has already shown the student the message.
   */
  const handled = (action, fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      reportApiFailure(error, { action, screen: step });
      if (error?.status === 429) startWait(error.retryAfter);
      return undefined;
    }
  };

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

  const handleCheckin = async (phone, number = '') => {
    addFlowBreadcrumb('action', { action: 'checkin', ...numberShape(phone) });
    loadRegistrationForm().catch(() => {}); // prefetch; a failure retries on render
    if (numbers) {
      loadAdmissionSteps().catch(() => {});
      loadNumberSteps().catch(() => {});
    }
    const result = settle(await checkStudent(phone, number));
    if (!result) return;
    if (result.admission) { followAdmission(result); return; }

    if (!result.exists) {
      notRegistered(result);
      return;
    }

    // Only an approved, unblocked student goes anywhere near the class link.
    routeTo(result.data);
  };

  const handleRegistration = async (formData) => {
    // 009Fixes / 01: code-first — confirm the phone before anything is saved.
    if (fixOn && !formData.ticket) {
      setPendingForm(formData);
      if (regTicket) return handleRegistration({ ...formData, ticket: regTicket });
      setStep('registerCode');
      return undefined;
    }
    addFlowBreadcrumb('action', { action: 'register', ...numberShape(phoneNumber) });
    const result = settle(await register(phoneNumber, formData, { quiet: formData.ticket ? [] : ['refresh_needed', 'verify_first'] }));
    const refusedFor = result?.error?.code;
    if (!result?.success && !formData.ticket && (refusedFor === 'refresh_needed' || refusedFor === 'verify_first')) {
      // 010Fixes / 01: this page's switches were out of date — the server
      // wants an admission number and the code first. No "refresh": go on.
      setNumbersSeen(true);
      setCodeFirstSeen(true);
      if (formData.number) {
        setPendingForm(formData);
        setStep('registerCode');
      } else {
        setStep(GATE.REGISTER); // the form now asks for an admission number
      }
      return undefined;
    }
    if (!result?.success) {
      if (fixOn) {
        // Back to the form, typing kept; a refused ticket asks for a new code.
        if (result?.error?.code === 'verify_first') setRegTicket(null);
        if (result) setStep(GATE.REGISTER);
      }
      return undefined;
    }
    setPendingForm(null);
    setRegTicket(null);
    // 009Fixes / 01: saved already confirmed — check in with the chosen number.
    if (result.next === 'checkin') {
      await handleCheckin(phoneNumber, formData.number ?? '');
      return undefined;
    }
    // (014Fixes / 02: registration no longer answers next 'verify'; with
    // admission numbers on it is always code-first.)

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
    setJoinTried(true);
    setStep('redirect');
    const result = settle(await redirectToZoom());
    if (!result || result.success) return;

    if (result.status === 429) {
      // Refused for asking too often: wait on the welcome card, not a spinner.
      reportApiFailure(result.error, { action: 'join', screen: 'redirect' });
      startWait(result.retryAfter);
      setStep(GATE.WELCOME);
      return;
    }
    try {
      // The server refused. Re-check so the screen reflects the real reason
      // rather than leaving the student on a spinner.
      const check = settle(await checkStudent(phoneNumber));
      if (check?.admission) followAdmission(check);
      else if (check) routeTo(check.data);
    } catch (error) {
      // The re-check failed too: back to the welcome card, not a spinner.
      setStep(GATE.WELCOME);
      throw error;
    }
  };

  const handleRefresh = async (source) => {
    addFlowBreadcrumb('action', { action: source === 'auto' ? 'auto-refresh' : 'refresh', ...numberShape(phoneNumber) });
    const result = settle(await checkStudent(phoneNumber));
    if (!result) return;
    if (result.admission) { followAdmission(result); return; }
    if (!result.exists) {
      notRegistered(result);
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
      if (result.admission) { followAdmission(result); return; }
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

            {/* 002Fixes / 08: new students learn to register in time. Only
                where the teacher approves new students, and only before a
                number is entered. */}
            {step === 'checkin' && requireApproval && (
              <p className="text-center text-white-50 small mb-3" data-testid="register-early-hint">
                <i className="bi bi-info-circle me-1" aria-hidden="true" />
                New here? Register <strong className="text-white">before class day</strong> — your teacher
                approves new students before class starts.
              </p>
            )}

            <RetryWaitNotice secondsLeft={waitSeconds} until={waitUntil} />

            <AnimatePresence mode="wait">
              {step === 'checkin' && (
                <CheckinCard
                  key={`checkin-${cardView.key}`}
                  session={session}
                  onSubmit={handled('checkin', handleCheckin)}
                  loading={loading}
                  waitSeconds={waitSeconds}
                  slow={slow}
                  failedSlow={failedSlow}
                  numbers={numbers}
                  notice={cardView.notice}
                  initialPhone={cardView.initialPhone}
                />
              )}

              {/* 014Fixes / 03: has a number — type it (lazy). */}
              {step === 'number' && (
                <Suspense key="number" fallback={stepFallback}>
                  <NumberStep
                    phone={phoneNumber}
                    session={label}
                    loading={loading}
                    waitSeconds={waitSeconds}
                    refusal={numberRefusal}
                    onSubmit={(number) => handled('checkin', handleCheckin)(phoneNumber, number)}
                    onChangePhone={() => backToCard(null, phoneNumber)}
                  />
                </Suspense>
              )}

              {/* 014Fixes / 04: no number yet — confirm the phone, the number is
                  given (a pop-up), then checked in with it (lazy). */}
              {step === 'admission' && (
                <Suspense key="admission" fallback={stepFallback}>
                  <FirstTimeFlow
                    session={session}
                    sessionName={label}
                    phone={phoneNumber}
                    allowDifferent={firstTimeFrom === 'verify_required'}
                    onCheckin={(number, phone) => handled('checkin', handleCheckin)(phone ?? phoneNumber, number)}
                    onHasNumber={(phone) => {
                      // Moved to a new phone: check in with it (the number step follows).
                      if (phone && phone !== phoneNumber) { handled('checkin', handleCheckin)(phone); return; }
                      setNumberRefusal(null);
                      setStep('number');
                    }}
                    onRefresh={(message) => backToCard({ tone: 'error', text: message })}
                    onBack={handleBack}
                  />
                </Suspense>
              )}

              {(step === GATE.REGISTER || step === 'registerCode') && (
                <Suspense key="register" fallback={stepFallback}>
                  {/* 009Fixes / 03: registered before with a number that never worked. */}
                  {fixOn && step === GATE.REGISTER && (
                    <p className="text-center small mb-3">
                      <button type="button" className="btn btn-link text-white p-0" onClick={() => setStep('fixByName')}>
                        Registered before with a different phone number? Find your registration
                      </button>
                    </p>
                  )}
                  {/* 009Fixes / 01: the form stays mounted (hidden) under its code step. */}
                  <div hidden={step === 'registerCode'}>
                    <RegistrationForm
                      session={session}
                      numbers={numbers}
                      classes={classes}
                      subjectsByClass={subjectsByClass}
                      phoneNumber={phoneNumber}
                      onSubmit={handled('register', handleRegistration)}
                      onBack={handleBack}
                      loading={loading}
                    />
                  </div>
                  {step === 'registerCode' && (
                    <RegisterCodeStep
                      session={session}
                      phone={phoneNumber}
                      onVerified={(ticket) => { setRegTicket(ticket); handled('register', handleRegistration)({ ...pendingForm, ticket }); }}
                      onRefused={(message) => backToCard({ tone: 'error', text: message })}
                      onBack={() => setStep(GATE.REGISTER)}
                    />
                  )}
                </Suspense>
              )}

              {step === 'fixByName' && (
                <Suspense key="fixByName" fallback={stepFallback}>
                  <FixNumberByName
                    session={session}
                    phone={phoneNumber}
                    classes={classes}
                    onFixed={numberFixed}
                    onBack={() => setStep(GATE.REGISTER)}
                  />
                </Suspense>
              )}

              {(step === GATE.PENDING || step === GATE.DUPLICATE) && (
                <PendingApprovalScreen
                  key={step}
                  duplicate={step === GATE.DUPLICATE}
                  session={session}
                  studentData={studentData}
                  onRefresh={handled('refresh', handleRefresh)}
                  classTime={classTime}
                  waitSeconds={waitSeconds}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === 'retired' && retired && (
                <m.div
                  key="retired"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-card"
                  data-testid="retired-number"
                >
                  <div className="py-4 text-center">
                    <div className="mb-3" style={{ fontSize: '2.5rem', color: '#d97706' }}>
                      <i className="bi bi-telephone-x" aria-hidden="true" />
                    </div>
                    <h3 className="fw-bold mb-2">Please use your other number</h3>
                    <p className="text-muted mb-4">{retiredMessage(retired.reason, retired.keptSuffix)}</p>
                    <button type="button" className="btn btn-primary btn-lg w-100" onClick={handleBack}>
                      <i className="bi bi-arrow-left me-2" aria-hidden="true" />
                      Use a different number
                    </button>
                  </div>
                </m.div>
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
                  onPaid={handled('paid', handlePaid)}
                  onBack={handleBack}
                  loading={loading}
                />
              )}

              {step === GATE.WELCOME && studentData && (
                <WelcomeBackCard
                  key="welcome"
                  session={session}
                  studentData={studentData}
                  onJoinNow={handled('join', handleRedirect)}
                  autoJoin={!joinTried}
                  waitSeconds={waitSeconds}
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
                  slow={slow}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
