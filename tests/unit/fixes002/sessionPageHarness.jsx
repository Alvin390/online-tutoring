import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The real SessionPage and the real useRegistration hook, with the NETWORK and
 * the screens stubbed — shared by the 002Fixes tests.
 *
 * The screens are reduced to the buttons a student presses, so a test can
 * drive the exact sequence of 26 Oct (check in → "Check again" → "Use a
 * different number" → late reply → "Check again") against the real state
 * logic. The API functions are vi.fn()s a test can make slow (deferred) or
 * fail.
 *
 * Call `vi.resetModules()` before, and `unmockSessionPage()` after, each test.
 */

export const PHONE = '+254711000009';
export const OTHER_PHONE = '+254722000008';

export const MOCKED = [
  '@services/api/student', '@services/api/studentAdmission', '@services/api/public', '@/context/ToastContext', '@utils/analytics',
  '@shared/config/FlagsContext',
  '@/features/registration/components/CheckinCard',
  '@/features/registration/components/RegistrationForm',
  '@/features/registration/components/PendingApprovalScreen',
  '@/features/registration/components/WelcomeBackCard',
  '@/features/registration/components/BlockedStudentScreen',
  '@/features/registration/components/SuccessScreen',
];

export function unmockSessionPage() {
  for (const id of MOCKED) vi.doUnmock(id);
}

/** A promise the test resolves or rejects when it chooses — a slow network. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * @param {object} opts
 * @param {object} [opts.api]             overrides for the API functions
 * @param {boolean} [opts.requireApproval]
 * @param {string[]} [opts.real]          screens to render for real, e.g. ['PendingApprovalScreen']
 * @returns the render utils, plus `api`, `toast` and `nextPhone` (what "Check in" submits)
 */
export async function renderSessionPage({ api: overrides = {}, requireApproval = true, real = [], schedule = null, checkinCard = null, flags = {}, classes } = {}) {
  const stub = (name, factory) => {
    const id = `@/features/registration/components/${name}`;
    if (real.includes(name)) vi.doUnmock(id);
    else vi.doMock(id, factory);
  };
  const api = {
    checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
    submitReceipt: vi.fn().mockResolvedValue({ ok: true }),
    getClassLink: vi.fn().mockResolvedValue({ url: 'https://zoom.us/j/1', provider: 'zoom', session: 'evening' }),
    resubmitRegistration: vi.fn().mockResolvedValue({ ok: true }),
    registerStudentApi: vi.fn().mockResolvedValue({ ok: true, student: { studentName: 'New', approvalStatus: 'pending', blocked: false } }),
    // 008Fixes / 04: confirming the phone and choosing a number.
    requestCode: vi.fn().mockResolvedValue({ ok: true, deliveryChannel: 'sms', expiresInSeconds: 600, retryAfterSeconds: 60 }),
    verifyCode: vi.fn().mockResolvedValue({ ok: true, ticket: 'v1.ticket', next: 'chooseNumber', numberKind: 'student' }),
    checkNumber: vi.fn().mockResolvedValue({ status: 'free', message: 'Available' }),
    chooseNumber: vi.fn().mockResolvedValue({ ok: true, kind: 'student', number: '4071', display: '4071' }),
    // 014Fixes / 04: the number the school gives.
    assignNumber: vi.fn().mockResolvedValue({ ok: true, kind: 'student', number: '7319', display: '7319' }),
    // 014Fixes / 07: the settings re-read when an answer looks out of date.
    getPublicBootstrap: vi.fn().mockResolvedValue({ flags: {}, sessions: [] }),
    // 009Fixes / 03: fix my number.
    fixNumberRequest: vi.fn().mockResolvedValue({ ok: true, deliveryChannel: 'sms', retryAfterSeconds: 60 }),
    fixNumberConfirm: vi.fn().mockResolvedValue({ ok: true, phone: '+254733000007', ticket: 'v1.fix', next: 'chooseNumber', numberKind: 'student' }),
    ...overrides,
  };
  const toast = { showError: vi.fn(), showSuccess: vi.fn() };
  const typed = { phone: PHONE };

  vi.doMock('@services/api/student', () => ({
    checkinStudent: (...a) => api.checkinStudent(...a),
    submitReceipt: (...a) => api.submitReceipt(...a),
    getClassLink: (...a) => api.getClassLink(...a),
    resubmitRegistration: (...a) => api.resubmitRegistration(...a),
  }));
  // 008Fixes / 04: the first-time steps' calls (their own module).
  vi.doMock('@services/api/studentAdmission', () => ({
    requestCode: (...a) => api.requestCode(...a),
    verifyCode: (...a) => api.verifyCode(...a),
    checkNumber: (...a) => api.checkNumber(...a),
    chooseNumber: (...a) => api.chooseNumber(...a),
    assignNumber: (...a) => api.assignNumber(...a),
    fixNumberRequest: (...a) => api.fixNumberRequest(...a),
    fixNumberConfirm: (...a) => api.fixNumberConfirm(...a),
  }));
  vi.doMock('@services/api/public', () => ({
    registerStudentApi: (...a) => api.registerStudentApi(...a),
    getPublicBootstrap: (...a) => api.getPublicBootstrap(...a),
  }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => toast, useOptionalToast: () => null }));
  vi.doMock('@utils/analytics', () => ({ trackRegistration: vi.fn(), trackZoomRedirect: vi.fn() }));
  // 009Fixes: `flags` turns on others (e.g. checkin.admissionNumbers, student.fixNumber).
  vi.doMock('@shared/config/FlagsContext', () => ({
    useFlag: (key) => (key === 'registration.requireApproval' ? requireApproval : flags[key] === true),
    flagsStore: { setFromRemote: vi.fn() },
  }));
  // 007Fixes / 01: a test may supply its own card to see the props it is given.
  vi.doMock('@/features/registration/components/CheckinCard', () => ({
    default: checkinCard
      ? (props) => checkinCard({ ...props, submit: () => props.onSubmit(typed.phone, typed.number) })
      : ({ onSubmit }) => <button type="button" onClick={() => onSubmit(typed.phone, typed.number)}>Check in</button>,
  }));
  vi.doMock('@/features/registration/components/RegistrationForm', () => ({
    default: ({ onSubmit, onBack }) => (
      <div data-testid="register">
        <button type="button" onClick={() => onSubmit({ studentName: 'New', class: 'Form 3', subjects: ['English'], receiptMessage: 'QAB123XYZ9 Confirmed', ...(typed.regNumber ? { number: typed.regNumber } : {}) })}>Register</button>
        <button type="button" onClick={onBack}>Back</button>
      </div>
    ),
  }));
  stub('PendingApprovalScreen', () => ({
    default: ({ onRefresh, onBack, studentData }) => (
      <div data-testid="pending">
        <span>{studentData?.studentName}</span>
        <button type="button" onClick={onRefresh}>Check again</button>
        <button type="button" onClick={onBack}>Use a different number</button>
      </div>
    ),
  }));
  stub('WelcomeBackCard', () => ({
    default: ({ onJoinNow, onBack, studentData }) => (
      <div data-testid="welcome">
        <span data-testid="welcome-name">{studentData?.studentName}</span>
        <button type="button" onClick={onJoinNow}>Join now</button>
        <button type="button" onClick={onBack}>Not you?</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/BlockedStudentScreen', () => ({
    default: ({ onPaid, onBack }) => (
      <div data-testid="blocked">
        <button type="button" onClick={() => onPaid({ status: 'success', balanceAfter: 0 })}>Simulate M-Pesa success</button>
        <button type="button" onClick={onBack}>Use a different number</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/SuccessScreen', () => ({ default: () => <div data-testid="to-class">Opening class</div> }));

  const { default: SessionPage } = await import('@/features/registration/components/SessionPage.jsx');
  const utils = render(<MemoryRouter><SessionPage session="evening" label="Evening" icon="bi-moon" gradient="#000" schedule={schedule} classes={classes} /></MemoryRouter>);
  return { ...utils, api, toast, typed };
}

/** Every phone number the page sent to check-in, in order. */
export const sentPhones = (api) => api.checkinStudent.mock.calls.map(([, phone]) => phone);
