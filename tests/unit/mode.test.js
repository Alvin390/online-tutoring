import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  paystackMode,
  darajaMode,
  darajaEnvironment,
  modeVar,
  paystackVar,
  darajaVar,
  describeModes,
} from '../../api/_lib/mode.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * dev / live mode resolution.
 *
 * The safety property under test: anything that is not exactly 'live' resolves
 * to dev. A typo in this variable must never silently start charging real
 * cards or moving real money.
 */

const SAVED = { ...process.env };

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (/^(PAYSTACK|DARAJA)/.test(key)) delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...SAVED };
});

describe('mode resolution defaults to dev', () => {
  it('defaults to dev when unset', () => {
    expect(paystackMode()).toBe('dev');
    expect(darajaMode()).toBe('dev');
  });

  it('resolves live only for the exact string', () => {
    process.env.PAYSTACK_MODE = 'live';
    expect(paystackMode()).toBe('live');
  });

  it('tolerates casing and whitespace', () => {
    process.env.PAYSTACK_MODE = '  LIVE  ';
    expect(paystackMode()).toBe('live');
  });

  it('treats every near-miss as dev, not live', () => {
    // The direction that matters: a typo must fail safe.
    for (const value of ['liv', 'Live!', 'production', 'prod', 'true', '1', 'yes', '']) {
      process.env.PAYSTACK_MODE = value;
      expect(paystackMode(), value).toBe('dev');
    }
  });
});

describe('the two providers are independent', () => {
  it('one can be live while the other is dev', () => {
    // Daraja production needs Safaricom approval that takes days; Paystack
    // live is a dashboard toggle. Coupling them would mean either testing
    // M-Pesa against live billing, or blocking real subscriptions.
    process.env.PAYSTACK_MODE = 'live';
    process.env.DARAJA_MODE = 'dev';

    expect(paystackMode()).toBe('live');
    expect(darajaMode()).toBe('dev');
    expect(darajaEnvironment()).toBe('sandbox');
  });

  it('maps daraja mode to its own environment naming', () => {
    process.env.DARAJA_MODE = 'live';
    expect(darajaEnvironment()).toBe('production');
  });
});

describe('variable selection', () => {
  it('picks the TEST variable in dev and LIVE in live', () => {
    process.env.PAYSTACK_SECRET_KEY_TEST = 'sk_test_abc';
    process.env.PAYSTACK_SECRET_KEY_LIVE = 'sk_live_xyz';

    process.env.PAYSTACK_MODE = 'dev';
    expect(paystackVar('PAYSTACK_SECRET_KEY')).toBe('sk_test_abc');

    process.env.PAYSTACK_MODE = 'live';
    expect(paystackVar('PAYSTACK_SECRET_KEY')).toBe('sk_live_xyz');
  });

  /**
   * The names here are INFIX and that is the whole point of the test.
   *
   * It previously set `DARAJA_CONSUMER_KEY_SANDBOX` — a name that appears
   * nowhere else in the project — and so agreed with a broken implementation
   * instead of with the contract. `.env.example:134`, ENV-SETUP-GUIDE and the
   * deployed Cloudflare secrets all use `DARAJA_SANDBOX_CONSUMER_KEY`, so the
   * real lookup missed every time and M-Pesa never loaded credentials from the
   * environment on any deployment.
   */
  it('uses SANDBOX rather than TEST for daraja, with the mode INFIXED', () => {
    process.env.DARAJA_SANDBOX_CONSUMER_KEY = 'sandbox-key';
    process.env.DARAJA_LIVE_CONSUMER_KEY = 'live-key';

    process.env.DARAJA_MODE = 'dev';
    expect(darajaVar('DARAJA_CONSUMER_KEY')).toBe('sandbox-key');

    process.env.DARAJA_MODE = 'live';
    expect(darajaVar('DARAJA_CONSUMER_KEY')).toBe('live-key');
  });

  it('does not read the suffixed spelling, which nothing else in the project uses', () => {
    process.env.DARAJA_CONSUMER_KEY_SANDBOX = 'wrong-shape';
    process.env.DARAJA_MODE = 'dev';
    expect(darajaVar('DARAJA_CONSUMER_KEY')).toBe('');
  });

  it('falls back to the unsuffixed name so an unmigrated deployment keeps working', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_legacy';
    expect(paystackVar('PAYSTACK_SECRET_KEY')).toBe('sk_test_legacy');
  });

  it('prefers the suffixed name over the fallback', () => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_legacy';
    process.env.PAYSTACK_SECRET_KEY_TEST = 'sk_test_new';
    expect(paystackVar('PAYSTACK_SECRET_KEY')).toBe('sk_test_new');
  });

  it('returns an empty string rather than undefined when nothing is set', () => {
    expect(paystackVar('PAYSTACK_SECRET_KEY')).toBe('');
    expect(modeVar('ANYTHING', 'dev')).toBe('');
  });
});

describe('describeModes', () => {
  it('summarises both providers for the health check banner', () => {
    process.env.PAYSTACK_MODE = 'live';
    process.env.DARAJA_MODE = 'dev';

    expect(describeModes()).toEqual({
      paystack: 'live',
      daraja: 'dev',
      darajaEnvironment: 'sandbox',
    });
  });
});

/**
 * The variable names the code looks up must be names that actually exist.
 *
 * This is the control that would have caught the infix bug on the day it was
 * written. Both readers of the Daraja credentials — `darajaVar` here and
 * `scripts/healthCheck.js` — resolved DIFFERENT names for the same secret, and
 * every existing test agreed with whichever implementation it was testing. So
 * this one agrees with neither: it reads `.env.example`, which is the file an
 * operator actually fills in, and checks the resolver lands on names that are
 * in it.
 */
describe('resolved names exist in .env.example', () => {
  const documented = new Set(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.example'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('=')).trim())
      .filter(Boolean)
  );

  const DARAJA_FIELDS = [
    'DARAJA_CONSUMER_KEY',
    'DARAJA_CONSUMER_SECRET',
    'DARAJA_PASSKEY',
    'DARAJA_SHORTCODE',
    'DARAJA_SHORTCODE_TYPE',
  ];

  const PAYSTACK_FIELDS = [
    'PAYSTACK_SECRET_KEY',
    'PAYSTACK_PLAN_BRONZE',
    'PAYSTACK_PLAN_SILVER',
    'PAYSTACK_PLAN_GOLD',
  ];

  for (const mode of ['dev', 'live']) {
    it(`resolves every Daraja credential to a documented name in ${mode} mode`, () => {
      process.env.DARAJA_MODE = mode;
      const infix = mode === 'live' ? 'LIVE' : 'SANDBOX';

      for (const base of DARAJA_FIELDS) {
        const expected = base.replace(/^DARAJA_/, `DARAJA_${infix}_`);
        expect(documented, `${expected} is not in .env.example`).toContain(expected);

        // And the resolver must actually read THAT name.
        process.env[expected] = `value-for-${expected}`;
        expect(darajaVar(base)).toBe(`value-for-${expected}`);
        delete process.env[expected];
      }
    });

    it(`resolves every Paystack credential to a documented name in ${mode} mode`, () => {
      process.env.PAYSTACK_MODE = mode;
      const suffix = mode === 'live' ? 'LIVE' : 'TEST';

      for (const base of PAYSTACK_FIELDS) {
        const expected = `${base}_${suffix}`;
        expect(documented, `${expected} is not in .env.example`).toContain(expected);

        process.env[expected] = `value-for-${expected}`;
        expect(paystackVar(base)).toBe(`value-for-${expected}`);
        delete process.env[expected];
      }
    });
  }
});
