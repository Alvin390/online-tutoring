import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * A SessionPage with its registration hook and screens stubbed — shared by the
 * 002Fixes tests. The screens are reduced to the buttons a student presses, so
 * a test can drive the exact sequence of 26 Oct (check in → "Check again" →
 * "Use a different number" → late reply → "Check again").
 *
 * Call `vi.resetModules()` before, and `unmockSessionPage()` after, each test.
 */

export const PHONE = '+254711000009';

export const MOCKED = [
  '@features/registration/hooks/useRegistration', '@/features/registration/hooks/useRegistration',
  '@shared/config/FlagsContext', '@/features/registration/components/CheckinCard',
  '@/features/registration/components/PendingApprovalScreen', '@/features/registration/components/WelcomeBackCard',
  '@/features/registration/components/SuccessScreen',
];

export function unmockSessionPage() {
  for (const id of MOCKED) vi.doUnmock(id);
}

/**
 * @param {object} reg   the useRegistration return value (spread over defaults)
 * @param {object} opts  { requireApproval }
 */
export async function renderSessionPage(reg, { requireApproval = true } = {}) {
  const hook = {
    loading: false,
    studentData: null,
    classLink: null,
    provider: 'zoom',
    countdown: 0,
    checkStudent: vi.fn(),
    register: vi.fn(),
    redirectToZoom: vi.fn().mockResolvedValue({ success: true }),
    submitReceipt: vi.fn(),
    resubmit: vi.fn(),
    joinNow: vi.fn(),
    ...reg,
  };
  const factory = () => ({ useRegistration: () => hook });
  vi.doMock('@features/registration/hooks/useRegistration', factory);
  vi.doMock('@/features/registration/hooks/useRegistration', factory);
  vi.doMock('@shared/config/FlagsContext', () => ({ useFlag: (key) => (key === 'registration.requireApproval' ? requireApproval : false) }));
  vi.doMock('@/features/registration/components/CheckinCard', () => ({
    default: ({ onSubmit }) => <button type="button" onClick={() => onSubmit(PHONE)}>Check in</button>,
  }));
  vi.doMock('@/features/registration/components/PendingApprovalScreen', () => ({
    default: ({ onRefresh, onBack }) => (
      <div data-testid="pending">
        <button type="button" onClick={onRefresh}>Check again</button>
        <button type="button" onClick={onBack}>Use a different number</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/WelcomeBackCard', () => ({
    default: ({ onJoinNow, onBack }) => (
      <div data-testid="welcome">
        <button type="button" onClick={onJoinNow}>Join now</button>
        <button type="button" onClick={onBack}>Not you?</button>
      </div>
    ),
  }));
  vi.doMock('@/features/registration/components/SuccessScreen', () => ({ default: () => <div data-testid="to-class">Opening class</div> }));

  const { default: SessionPage } = await import('@/features/registration/components/SessionPage.jsx');
  const utils = render(<MemoryRouter><SessionPage session="evening" label="Evening" icon="bi-moon" gradient="#000" /></MemoryRouter>);
  return { ...utils, hook };
}
