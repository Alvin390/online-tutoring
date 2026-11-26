/**
 * The owner console's one page — 013Fixes / 38. No build step: plain HTML and
 * a small script. School data is only ever put on the page as text
 * (textContent), never as HTML. The script runs under a per-response nonce
 * (Content-Security-Policy, console/worker.js).
 */

export function pageHtml(nonce) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Owner console</title>
<style nonce="${nonce}">
  :root { color-scheme: light; --line: #d9dde3; --muted: #5c6670; --bad: #b42318; --warn: #b54708; --ok: #067647; }
  body { font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f6f7f9; color: #1d2329; }
  main { max-width: 1200px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 20px; margin: 8px 0 16px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; }
  button { font: inherit; padding: 6px 12px; border: 1px solid #3056d3; background: #3056d3; color: #fff; border-radius: 6px; cursor: pointer; }
  button.link { background: none; color: #3056d3; border: none; padding: 0; }
  button:disabled { opacity: .5; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; color: var(--muted); }
  .muted { color: var(--muted); font-size: 13px; }
  .bad { color: var(--bad); font-weight: 600; } .warn { color: var(--warn); font-weight: 600; } .ok { color: var(--ok); }
  .scroll { overflow-x: auto; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Owner console</h1>

  <section id="signin" class="card" hidden>
    <form id="signin-form" class="row" autocomplete="off">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>
    <p id="signin-error" class="bad" role="alert"></p>
  </section>

  <section id="app" hidden>
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <span class="muted" id="checked">Not loaded yet.</span>
        <span class="row">
          <button type="button" id="refresh">Refresh</button>
          <button type="button" id="signout" class="link">Sign out</button>
        </span>
      </div>
      <div class="scroll">
        <table aria-label="Schools">
          <thead><tr>
            <th>School</th><th>Plan</th><th>Status</th><th>Days left</th><th>Last payment</th>
            <th>Usage</th><th>SMS units</th><th>Modes</th><th>Version</th><th></th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p class="muted">Read-only. Changes are made in each school's own superadmin.</p>
    </div>

    <div class="card">
      <h2 style="font-size:16px;margin-top:0">Schools</h2>
      <form id="add-form" class="row">
        <input id="add-name" placeholder="School name" required maxlength="60">
        <input id="add-url" placeholder="https://school.example" required>
        <input id="add-secret" placeholder="Secret name (optional)" maxlength="45">
        <button type="submit">Add school</button>
      </form>
      <p id="registry-error" class="bad" role="alert"></p>
      <ul id="registry" class="muted"></ul>
    </div>

    <div class="card" id="digest-card">
      <h2 style="font-size:16px;margin-top:0">Daily digest</h2>
      <form id="digest-form" class="row">
        <label for="digest-to">Email to</label>
        <input id="digest-to" type="email" maxlength="200">
        <button type="submit">Save</button>
      </form>
      <p id="digest-note" class="muted"></p>
    </div>
  </section>
</main>
<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text ?? ''; if (cls) td.className = cls; tr.appendChild(td); return td; };

  function show(signedIn) { $('signin').hidden = signedIn; $('app').hidden = !signedIn; }

  async function loadRegistry() {
    const res = await fetch('/api/registry', { credentials: 'same-origin' });
    if (res.status === 401) { show(false); return false; }
    const { schools } = await res.json();
    const ul = $('registry'); ul.textContent = '';
    for (const s of schools) {
      const li = document.createElement('li');
      li.textContent = s.name + ' \\u2014 ' + s.url + (s.secretRef ? ' (' + s.secretRef + ')' : '') + ' ';
      const rm = document.createElement('button'); rm.className = 'link'; rm.textContent = 'Remove';
      rm.onclick = async () => { if (!confirm('Remove ' + s.name + ' from the console?')) return; await post('/api/registry', { action: 'remove', id: s.id }); await refreshAll(); };
      li.appendChild(rm); ul.appendChild(li);
    }
    return true;
  }

  async function loadTable() {
    $('refresh').disabled = true; $('checked').textContent = 'Checking every school\\u2026';
    try {
      const res = await fetch('/api/schools', { credentials: 'same-origin' });
      if (res.status === 401) { show(false); return; }
      const { rows, checkedAt } = await res.json();
      const body = $('rows'); body.textContent = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        cell(tr, r.name);
        if (!r.reachable) {
          const td = cell(tr, "Can't reach this school (" + (r.error || 'no answer') + ')', 'bad'); td.colSpan = 8;
        } else {
          cell(tr, r.plan); cell(tr, r.status, r.statusClass); cell(tr, r.daysLeft, r.daysClass); cell(tr, r.lastPayment);
          cell(tr, r.usage, r.usageClass); cell(tr, r.sms, r.smsClass); cell(tr, r.modes, r.modesClass); cell(tr, r.version);
        }
        const td = document.createElement('td'); const a = document.createElement('a');
        a.href = r.superadminUrl; a.textContent = 'Superadmin'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        td.appendChild(a); tr.appendChild(td); body.appendChild(tr);
      }
      $('checked').textContent = rows.length ? 'Checked ' + new Date(checkedAt).toLocaleString() : 'No schools yet: add one below.';
    } catch { $('checked').textContent = 'Could not load. Try Refresh.'; }
    finally { $('refresh').disabled = false; }
  }

  async function loadDigest() {
    const res = await fetch('/api/settings', { credentials: 'same-origin' });
    if (!res.ok) return;
    const s = await res.json();
    $('digest-to').value = s.digestTo || '';
    $('digest-note').textContent = s.digestTo ? 'Sent every morning (Nairobi) to ' + s.digestTo + '.' : 'No address yet: the daily digest is not sent.';
  }

  async function refreshAll() { if (await loadRegistry()) { show(true); await Promise.all([loadTable(), loadDigest()]); } }

  $('signin-form').onsubmit = async (e) => {
    e.preventDefault(); $('signin-error').textContent = '';
    const res = await post('/login', { password: $('password').value });
    $('password').value = '';
    if (res.ok) { await refreshAll(); return; }
    $('signin-error').textContent = res.status === 429 ? 'Too many tries. Wait a minute.' : res.status === 503 ? 'The console is not set up yet.' : 'Wrong password.';
  };
  $('signout').onclick = async () => { await post('/logout', {}); show(false); };
  $('refresh').onclick = loadTable;
  $('add-form').onsubmit = async (e) => {
    e.preventDefault(); $('registry-error').textContent = '';
    const res = await post('/api/registry', { action: 'add', name: $('add-name').value, url: $('add-url').value, secretRef: $('add-secret').value || undefined });
    if (!res.ok) { $('registry-error').textContent = (await res.json().catch(() => ({}))).error?.message || 'That did not work.'; return; }
    $('add-form').reset(); await refreshAll();
  };
  $('digest-form').onsubmit = async (e) => {
    e.preventDefault();
    const res = await post('/api/settings', { digestTo: $('digest-to').value.trim() });
    $('digest-note').textContent = res.ok ? 'Saved.' : ((await res.json().catch(() => ({}))).error?.message || 'That did not work.');
    if (res.ok) await loadDigest();
  };

  refreshAll();
})();
</script>
</body>
</html>`;
}
