#!/usr/bin/env node
/**
 * postinstall — runs the health check and a build after a local `npm install`,
 * exactly as before, but does nothing in CI.
 *
 * In CI, `npm ci` used to trigger a full `vite build` as a side effect, and the
 * workflow then built again — every run paid for two production builds. The
 * workflow sets CI=true (GitHub Actions also sets it by default).
 */
import { spawnSync } from 'node:child_process';

if (process.env.CI) {
  console.log('postinstall: CI detected — skipping health check and build.');
  process.exit(0);
}

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

run(process.execPath, ['scripts/healthCheck.js']);
const build = run('npx', ['vite', 'build']);
process.exit(build.status ?? 0);
