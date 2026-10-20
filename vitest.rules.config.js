import { defineConfig } from 'vitest/config';

/**
 * Rules tests run in a Node environment against the Firestore emulator, not in
 * jsdom, and they must not load tests/setup.js (which stubs browser globals).
 * Hence a separate config from vitest.config.js.
 *
 * Run with: npm run test:rules
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/rules/**/*.test.js'],
    // Emulator round trips are slower than unit tests, and the suite shares one
    // emulator instance, so it runs serially.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    // Phase 13 / 02: with a second rules file, files ran in PARALLEL against
    // the one emulator (Vitest 4 ignores poolOptions.forks.singleFork), and one
    // file's clearFirestore() wiped another's seeded data mid-test. Serial
    // files, as vitest.handlers.config.js already does.
    fileParallelism: false,
  },
});
