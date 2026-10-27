import { sentryVitePlugin } from '@sentry/vite-plugin';
import { releaseName } from '../src/shared/utils/releaseName.js';

/**
 * Source maps to Sentry at build time — 002Fixes / 10.
 *
 * Only when SENTRY_AUTH_TOKEN is set, which is only ever in Cloudflare
 * Workers Builds' "Build variables and secrets" (the owner adds it; see
 * docs/LAUNCH.md). Every other build — local, CI, the gate — gets no plugin
 * and is exactly as before.
 *
 * The maps go to the same release the app reports at runtime, and are deleted
 * from the output after upload so the site never serves them (they used to be
 * public: /assets/index-*.js.map returned 200). scripts/stripSourceMaps.js
 * deletes them on builds without a token too.
 *
 * @param {Record<string,string|undefined>} env  process.env, or a test's stand-in
 * @param {string} commit  the short commit vite.config.js computed
 * @returns {import('vite').PluginOption[]}
 */
export function sentryPlugins(env, commit) {
  if (!env.SENTRY_AUTH_TOKEN) return [];
  const name = releaseName(env.VITE_APP_VERSION, commit);
  return [
    sentryVitePlugin({
      authToken: env.SENTRY_AUTH_TOKEN,
      org: env.SENTRY_ORG,
      project: env.SENTRY_PROJECT,
      // The org is on Sentry's EU region; without this the upload goes to the US one.
      url: env.SENTRY_URL,
      ...(name ? { release: { name, inject: false } } : {}),
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      telemetry: false,
    }),
  ];
}
