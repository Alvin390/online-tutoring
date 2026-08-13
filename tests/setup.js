import { afterEach, vi } from 'vitest';

/**
 * Shared test setup.
 *
 * Everything below is DOM setup, and this file is the global `setupFiles`
 * entry, so it runs for EVERY test — including the ones that opt into the node
 * environment with `// @vitest-environment node`.
 *
 * Phase 12 added several of those: the Cloudflare migration's credential
 * signing, Firestore REST codec and Worker request adapter all need real Web
 * Crypto and a real `fetch`, and jsdom shadows both with stubs. So the DOM half
 * is guarded on `window` actually existing rather than assumed.
 */

const isDom = typeof window !== 'undefined';

if (isDom) {
  await import('@testing-library/jest-dom');
  const { cleanup } = await import('@testing-library/react');

  afterEach(() => {
    cleanup();
  });

  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock window.location
  delete window.location;
  window.location = {
    href: 'http://localhost:5173',
    origin: 'http://localhost:5173',
    reload: vi.fn(),
  };

  // Mock navigator.clipboard
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(),
    },
  });

  // Mock IntersectionObserver
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    takeRecords() {
      return [];
    }
    unobserve() {}
  };
}
