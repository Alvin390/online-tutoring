#!/usr/bin/env node
/**
 * Generates GMAIL_REFRESH_TOKEN for report alerts — Phase 13 / 06.
 * Walkthrough: issues/plan/appendix-c-gmail-api-setup.md (step 5).
 *
 * Google's "installed app" loopback flow with PKCE:
 *   1. a throwaway HTTP server on 127.0.0.1 (random port)
 *   2. you open the printed consent URL and sign in AS THE SENDER ACCOUNT
 *   3. Google redirects back with a code, exchanged here for a refresh token
 *   4. the token is PRINTED, never written to a file, and one test email is
 *      sent to prove it works
 *
 * Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (a "Desktop app" OAuth client)
 * in the environment, .dev.vars or .env.local.
 *
 * Usage:
 *   npm run gmail:auth
 *   npm run gmail:auth -- --to someone@example.com   test email recipient
 *   npm run gmail:auth -- --no-test                  skip the test email
 */

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_TEST_RECIPIENT = 'alvinmk06@gmail.com';

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makePkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * The consent URL. `access_type=offline` + `prompt=consent` are what make
 * Google return a REFRESH token (and a fresh one on every run).
 */
export function buildConsentUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SEND_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return url.toString();
}

function loadEnvFiles() {
  for (const name of ['.dev.vars', '.env.local']) {
    const path = resolve(ROOT, name);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const key = line.slice(0, line.indexOf('=')).trim();
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (key.startsWith('GMAIL_') && value && !process.env[key]) process.env[key] = value;
    }
  }
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Printing the URL is the fallback; nothing else to do.
  }
}

function waitForCode(server, expectedState) {
  return new Promise((resolveCode, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out after 5 minutes waiting for Google.')), 5 * 60_000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === expectedState;
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok
        ? '<h2>Done.</h2><p>You can close this tab and return to the terminal.</p>'
        : `<h2>Authorisation failed</h2><p>${error ? String(error).replace(/[<>&]/g, '') : 'State mismatch.'}</p>`);
      clearTimeout(timer);
      if (ok) resolveCode(code);
      else reject(new Error(error ? `Google returned: ${error}` : 'State mismatch — possible stale tab; run again.'));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const toIndex = args.indexOf('--to');
  const testTo = toIndex !== -1 ? args[toIndex + 1] : DEFAULT_TEST_RECIPIENT;
  const skipTest = args.includes('--no-test');

  loadEnvFiles();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required (env, .dev.vars or .env.local).');
    console.error('See issues/plan/appendix-c-gmail-api-setup.md, step 4.');
    process.exit(1);
  }

  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const { verifier, challenge } = makePkce();
  const state = base64url(randomBytes(16));
  const consentUrl = buildConsentUrl({ clientId, redirectUri, challenge, state });

  console.log('\nSign in AS THE SENDER ACCOUNT and approve "Send email on your behalf".');
  console.log('If the browser does not open, paste this URL:\n');
  console.log(`  ${consentUrl}\n`);
  openBrowser(consentUrl);

  let code;
  try {
    code = await waitForCode(server, state);
  } finally {
    server.close();
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.refresh_token) {
    console.error(`Token exchange failed (${response.status}): ${tokens.error ?? 'no refresh_token returned'}`);
    process.exit(1);
  }

  console.log('Add this to .dev.vars and .env.local (both git-ignored), then run npm run cf:secrets:\n');
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);

  if (skipTest) return;
  if (!process.env.GMAIL_SENDER) {
    console.log('GMAIL_SENDER is not set, so no test email was sent. Set it and use the superadmin "Send test email".');
    return;
  }

  process.env.GMAIL_REFRESH_TOKEN = tokens.refresh_token;
  const { sendGmail } = await import('../api/_lib/gmail.js');
  await sendGmail({
    to: testTo,
    subject: 'Test alert from Online Tutoring',
    text: `Gmail is connected. Report alerts will be sent from ${process.env.GMAIL_SENDER}.`,
    html: `<p>Gmail is connected. Report alerts will be sent from <strong>${process.env.GMAIL_SENDER}</strong>.</p>`,
  });
  console.log(`Test email sent to ${testTo}. Check Spam once, and add the filter from appendix C step 7.`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
