#!/usr/bin/env node
/**
 * Local development, all in one command: `npm run dev`.
 *
 * Starts the API (the Cloudflare Worker under `wrangler dev`, on :8787, reading
 * .dev.vars) and the Vite dev server (:5173), which forwards /api/* to it (see
 * the proxy in vite.config.js). Ctrl+C stops both.
 *
 * Before this, `npm run dev` started only Vite, so every API call failed with
 * a 404 unless `npm run dev:api` was also running in a second terminal.
 *
 *   npm run dev          both
 *   npm run dev:quiet    Vite only (when the API runs elsewhere)
 *   npm run dev:api      the Worker only
 */

import { spawn } from 'node:child_process';

const children = [];

function run(name, command, colour) {
  const child = spawn(command, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${colour}m[${name}]\x1b[0m `;
  const relay = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited (${code ?? 'signal'})\n`);
    if (code && code !== 0) shutdown(code);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      // A shell-spawned tree on Windows only stops with taskkill /T.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGINT');
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', 'npx wrangler dev --port 8787', 36);
run('web', 'npx vite', 35);
