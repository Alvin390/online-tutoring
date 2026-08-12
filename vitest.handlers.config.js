import { defineConfig } from 'vitest/config';

/**
 * Handler integration tests — Phase 11 D1.
 *
 * These exercise the real serverless logic (the ledger, the subscription state
 * machine, the callback path) against a live Firestore emulator with the Admin
 * SDK. Node environment, no jsdom, no browser setup file.
 *
 * Run with: npm run test:handlers
 *
 * Serial and single-fork: the tests share one emulator and several of them
 * deliberately create write contention, which is the whole point.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/handlers/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
