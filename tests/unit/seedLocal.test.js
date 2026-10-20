import { describe, it, expect } from 'vitest';
import { assertEmulator } from '../../scripts/perf/seedLocal.mjs';

// Phase 13 / 01 D4. The seeder writes 1,000+ documents; it must be impossible
// to point it at production by forgetting an environment variable.
describe('scripts/perf/seedLocal.mjs', () => {
  it('refuses to run without FIRESTORE_EMULATOR_HOST', () => {
    expect(() => assertEmulator({})).toThrow(/emulator only/);
  });

  it('runs when the emulator host is set', () => {
    expect(() => assertEmulator({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' })).not.toThrow();
  });
});
