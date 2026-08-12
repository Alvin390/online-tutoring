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

  it('uses SANDBOX rather than TEST for daraja', () => {
    process.env.DARAJA_CONSUMER_KEY_SANDBOX = 'sandbox-key';
    process.env.DARAJA_CONSUMER_KEY_LIVE = 'live-key';

    process.env.DARAJA_MODE = 'dev';
    expect(darajaVar('DARAJA_CONSUMER_KEY')).toBe('sandbox-key');

    process.env.DARAJA_MODE = 'live';
    expect(darajaVar('DARAJA_CONSUMER_KEY')).toBe('live-key');
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
