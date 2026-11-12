import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * 007Fixes / 02: the three readers of the bootstrap agree when the network
 * fails and the phone has a saved copy. A custom session still opens, and the
 * flags are the school's, not the defaults (requireApproval would otherwise
 * read false on the student page).
 */

const KEY = 'ot.bootstrap.v1';
const COPY = {
  savedAt: Date.now(),
  flags: { 'registration.requireApproval': true },
  sessions: [{ slug: 'saturday', name: 'Saturday Class', active: true }],
};
const timeout = () => Object.assign(new Error('timed out'), { name: 'ApiError', code: 'timeout' });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.doMock('@services/api/client', () => ({ apiGet: vi.fn().mockRejectedValue(timeout()), apiPost: vi.fn() }));
  vi.doMock('@/features/registration/components/SessionPage', () => ({
    default: ({ session, label }) => <div data-testid="session-page">{session}|{label}</div>,
  }));
});
afterEach(() => {
  cleanup();
  vi.doUnmock('@services/api/client');
  vi.doUnmock('@/features/registration/components/SessionPage');
  localStorage.clear();
});

async function openSlug(slug) {
  const { default: SessionRoutePage } = await import('@/pages/SessionRoutePage');
  render(
    <MemoryRouter initialEntries={[`/${slug}`]}>
      <Routes><Route path="/:sessionSlug" element={<SessionRoutePage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('offline with a saved copy', () => {
  it('a custom session opens from the copy', async () => {
    localStorage.setItem(KEY, JSON.stringify(COPY));
    await openSlug('saturday');
    expect((await screen.findByTestId('session-page')).textContent).toBe('saturday|Saturday Class');
  });

  it('the flags come from the copy, not the defaults', async () => {
    localStorage.setItem(KEY, JSON.stringify(COPY));
    const { FlagsProvider, useFlag } = await import('@shared/config/FlagsContext');
    const Probe = () => <span data-testid="flag">{String(useFlag('registration.requireApproval'))}</span>;
    render(<FlagsProvider><Probe /></FlagsProvider>);
    await waitFor(() => expect(screen.getByTestId('flag').textContent).toBe('true'));
  });
});

describe('offline with no saved copy (as before)', () => {
  it('morning still opens from the built-in fallback', async () => {
    await openSlug('morning');
    expect((await screen.findByTestId('session-page')).textContent).toMatch(/^morning\|/);
  });

  it('a custom session is not found', async () => {
    await openSlug('saturday');
    await waitFor(() => expect(screen.queryByTestId('session-page')).toBeNull());
  });
});
