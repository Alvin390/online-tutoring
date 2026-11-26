# Owner console

One page listing every school: plan, status, days left, last payment, usage, SMS units, modes and version, with a link to each school's superadmin. It is **read-only**: changes are made in each school's own superadmin. A daily digest email lists the schools that need a look.

It is a separate Cloudflare Worker (`online-tutoring-console`), deployed by hand from this folder. Each school's Worker is deployed by Workers Builds as before.

## How it works

- **Each school answers a signed status link,** `GET /api/platform/status` (013Fixes / 37), and only when its `CONSOLE_SECRET` is set.
  - **The console signs each request** with the same `CONSOLE_SECRET`, over the method, host, path and time. A captured request is only good for that school, for 5 minutes.
  - **The reply has no student, phone, email or payment code.**
- **Who gets in:** only the owner, with the owner password (`CONSOLE_PASSWORD`).
  - **The session** is a 12-hour cookie signed with `CONSOLE_SESSION_SECRET`.
  - **Changing the password** signs everyone out.
  - **Sign-in tries** are limited to 5 a minute.
- **The registry:** the list of schools is kept in the console's own KV (`CONSOLE_KV`). Each entry is a name, an https address, and optionally the name of the secret or Service Binding to use. No secrets are stored in it.
- **The digest** runs at 07:00 Nairobi. It covers schools ending in 7 days or less, locked or expired, over a usage limit, low on SMS, or unreachable.
  - **The address** is set on the page.
  - **It isn't sent** when nothing needs a look, or when no address is set.
- **Same-zone fetches:** the schools and the console share the `workers.dev` zone, where one Worker fetching another fails (Cloudflare error 1042). `global_fetch_strictly_public` in `wrangler.jsonc` sends the fetch over the public internet. A Service Binding per school also works: name it in the registry and declare it in `wrangler.jsonc`.

## Setting it up (once)

All commands run from the repository root. Secrets are typed or piped in and never printed.

1. **Create the KV namespace** and put its id in `console/wrangler.jsonc` (`kv_namespaces[0].id`):
   `npx wrangler kv namespace create CONSOLE_KV`
2. **Generate the shared signing secret, and set it on the school and the console** without printing it:

   ```
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > .console-secret.tmp
   npx wrangler secret put CONSOLE_SECRET < .console-secret.tmp
   npx wrangler secret put CONSOLE_SECRET -c console/wrangler.jsonc < .console-secret.tmp
   rm .console-secret.tmp
   ```

3. **Set the console's own secrets** (`-c console/wrangler.jsonc`):
   - `CONSOLE_PASSWORD`: the owner's password, typed at the prompt;
   - `CONSOLE_SESSION_SECRET`: another random value, made as in step 2;
   - for the digest: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` (the same values as the school's).
4. **Deploy:** `npx wrangler deploy -c console/wrangler.jsonc`
5. **Open the console,** sign in, add the school (its https address), and set the digest address.

## Switching it off

- **The console:** delete the Worker with `npx wrangler delete -c console/wrangler.jsonc`.
- **One school's status link:** remove that school's `CONSOLE_SECRET` with `npx wrangler secret delete CONSOLE_SECRET`. The link then answers 404.
