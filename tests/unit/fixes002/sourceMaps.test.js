// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stripSourceMaps } from '../../../scripts/stripSourceMaps.js';
import { sentryPlugins } from '../../../scripts/sentryBuild.js';
import { releaseName } from '../../../src/shared/utils/releaseName.js';
import { releaseName as runtimeReleaseName } from '@utils/monitoring';

/**
 * 002Fixes / 10 — source maps go to Sentry only when the build has the token,
 * and never stay in the deployed output.
 */

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fx002-maps-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('stripSourceMaps', () => {
  it('removes every .map file, at any depth, and nothing else', () => {
    mkdirSync(join(dir, 'assets', 'nested'), { recursive: true });
    const keep = ['index.html', 'sw.js', 'assets/index-abc.js', 'assets/style.css', 'assets/nested/chunk.js', 'assets/mapping.json'];
    const drop = ['sw.js.map', 'assets/index-abc.js.map', 'assets/nested/chunk.js.map'];
    for (const f of [...keep, ...drop]) writeFileSync(join(dir, f), 'x');
    const removed = stripSourceMaps(dir);
    expect(removed).toHaveLength(3);
    for (const f of drop) expect(existsSync(join(dir, f))).toBe(false);
    for (const f of keep) expect(existsSync(join(dir, f))).toBe(true);
  });

  it('a missing directory is not an error', () => {
    expect(stripSourceMaps(join(dir, 'nope'))).toEqual([]);
  });
});

describe('sentryPlugins', () => {
  it('no token: no plugin — local, CI and gate builds are unchanged', () => {
    expect(sentryPlugins({}, 'abc1234')).toEqual([]);
    expect(sentryPlugins({ SENTRY_ORG: 'alvin-kariuki', VITE_APP_VERSION: '2.0.0' }, 'abc1234')).toEqual([]);
  });

  it('with the token: the Sentry upload plugin is added', () => {
    const plugins = sentryPlugins({
      SENTRY_AUTH_TOKEN: 'sntrys_test', SENTRY_ORG: 'alvin-kariuki', SENTRY_PROJECT: 'online-tutoring-1',
      SENTRY_URL: 'https://de.sentry.io', VITE_APP_VERSION: '2.0.0',
    }, 'abc1234').flat();
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.some((p) => /sentry/i.test(p?.name ?? ''))).toBe(true);
  });
});

describe('one release name for the app and its maps', () => {
  it('the runtime and the upload use the same function', () => {
    expect(runtimeReleaseName).toBe(releaseName);
    expect(releaseName('2.0.0', 'abc1234')).toBe('online-tutoring@2.0.0+abc1234');
  });
});
