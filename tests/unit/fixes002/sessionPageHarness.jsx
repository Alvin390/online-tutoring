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
  '@services/api/student', '@services/api/public', '@/context/ToastContext', '@utils/analytics',
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
 * @returns the render utils, plus `api`, `toast` and `nextPhone` (what "Check in" submits)
 */
export async function renderSessionPage({ api: overrides = {}, requireApproval = true } = {}) {
  const api = {
    checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null }),
    submitReceipt: vi.fn().mockResolvedValue({ ok: true }),
    getClassLink: vi.fn().mockResolvedValue({ url: 'https://zoom.us/j/1', provider: 'zoom', session: 'evening' }),
    resubmitRegistration: vi.fn().mockResolvedValue({ ok: true }),
    registerStudentApi: vi.fn().mockResolvedValue({ ok: true, student: { studentName: 'New', approvalStatus: 'pending', blocked: false } }),
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
  vi.doMock('@services/api/public', () => ({ registerStudentApi: (...a) => api.registerStudentApi(...a) }));
  vi.doMock('@/context/ToastContext', () => ({ useToast: () => toast }));
  vi.doMock('@utils/analytics', () => ({ trackRegistration: vi.fn(), trackZoomRedirect: vi.fn() }));
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (key) => (key === 'registration.requireApproval' ? requireApproval : false) }));
  vi.doMock('@/features/registration/components/CheckinCard', () => ({
    default: ({ onSubmit }) => <button type="button" onClick={() => onSubmit(typed.phone)}>Check in</button>,
  }));
  vi.doMock('@/features/registration/components/RegistrationForm', () => ({
    default: ({ onSubmit, onBack }) => (
      <div data-testid="register">
        <button type="button" onClick={() => onSubmit({ studentName: 'New', class: 'Form 3', subjects: ['English'], receiptMessage: 'QAB123XYZ9 Confirmed' })}>Register</button>
        <button type="button" onClick={onBack}>Back</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/PendingApprovalScreen', () => ({
    default: ({ onRefresh, onBack, studentData }) => (
      <div data-testid="pending">
        <span>{studentData?.studentName}</span>
        <button type="button" onClick={onRefresh}>Check again</button>
        <button type="button" onClick={onBack}>Use a different number</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/WelcomeBackCard', () => ({
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
  const utils = render(<MemoryRouter><SessionPage session="evening" label="Evening" icon="bi-moon" gradient="#000" /></MemoryRouter>);
  return { ...utils, api, toast, typed };
}

/** Every phone number the page sent to check-in, in order. */
export const sentPhones = (api) => api.checkinStudent.mock.calls.map(([, phone]) => phone);
