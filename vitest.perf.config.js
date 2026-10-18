import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Render benchmarks — Phase 13 / 01 D3. Recorded, not gated; excluded from
 * `npm run test:all` (tests/perf/** is in the base config's exclude list).
 *
 *   npm run perf:render
 *
 * Built by spreading rather than mergeConfig: mergeConfig CONCATENATES arrays,
 * so the base config's exclude of tests/perf/** would survive and exclude
 * everything here.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/perf/**/*.perf.test.jsx'],
    exclude: ['node_modules/**'],
    testTimeout: 120_000,
  },
});
