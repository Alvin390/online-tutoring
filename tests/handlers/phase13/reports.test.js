import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  externalCalls, fakes, resetFakes, decodeGmailRaw, drainWaitUntil, waitUntilPromises,
  useFakeServiceAccount, loadWorker,
} from '../_worker.js';

/**
 * Phase 13 / 06 — bug reports, feature requests, and the Gmail alert.
 *
 * Gmail, Google OAuth and Cloud Storage are fakes in the harness fetch guard;
 * every send is recorded, so these assert the exact message Gmail was given.
 */

const TEACHER = 'p13-reports-teacher';
const OTHER = 'p13-reports-other';
const SUPER = 'p13-reports-super';
const CRON = { authorization: 'Bearer test-cron-secret' };

let db;
let teacher;
let other;
let superadmin;
let noRole;
let gmailMod;

// A real 1×1 PNG, and a minimal WebP header (the sniffer reads magic bytes).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const webp = (seed) => Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(28, seed),
]).toString('base64');
// Incompressible-looking filler, so the test body is the size a real image is.
const randomBytesish = (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7919 + 13) % 251));
const PDF = Buffer.from('%PDF-1.7\n% not an image\n').toString('base64');

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  await useFakeServiceAccount();
  db = await getTestDb();
  gmailMod = await import('../../../api/_lib/gmail.js');
  teacher = await userWithClaims(TEACHER, teacherClaims.silver, { email: 'zoe.teacher@harness.example' });
  other = await userWithClaims(OTHER, teacherClaims.bronze);
  superadmin = await userWithClaims(SUPER, teacherClaims.superadmin);
  noRole = await userWithClaims('p13-reports-norole', {});
});

beforeEach(async () => {
  await drainWaitUntil();
  await clearFirestore();
  resetFakes();
  gmailMod.__resetGmailTokenCache();
});

const gmailSends = () => externalCalls.filter((c) => c.url.startsWith('https://gmail.googleapis.com'));
// Gmail's refresh-token exchanges only (Storage's own JWT-bearer exchanges also go to oauth2).
const tokenExchanges = () => externalCalls.filter((c) => c.url.startsWith('https://oauth2.googleapis.com')
  && String(typeof c.body === 'string' ? c.body : new URLSearchParams(c.body ?? {})).includes('grant_type=refresh_token'));
const headerOf = (raw, name) => new RegExp(`^${name}: (.*)$`, 'm').exec(raw)?.[1];
const decodeSubject = (value) => {
  const m = /^=\?UTF-8\?B\?(.+)\?=$/.exec(value ?? '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : value;
};

const bug = (overrides = {}) => ({
  type: 'bug',
  reportId: randomUUID(),
  title: 'Zoë cannot join the evening class',
  description: 'The join button spins forever on the evening page.',
  steps: '1. Open /evening\n2. Tap Join',
  expected: 'The class opens',
  severity: 'blocking',
  context: { page: '/dashboard', userAgent: 'harness', viewport: '390x844', appVersion: '13.6.0' },
  ...overrides,
});

const feature = (overrides = {}) => ({
  type: 'feature',
  reportId: randomUUID(),
  title: 'Export attendance to Excel',
  description: 'A button that downloads this month as a spreadsheet.',
  problem: 'I copy it by hand every month.',
  urgency: 'soon',
  ...overrides,
});

const submit = (body, token = teacher) => call('/api/reports/submit', { token, body });
const report = async (id) => (await db.doc(`reports/${id}`).get()).data();
const sweep = () => call('/api/cron/notificationsSweep', { headers: CRON });

// ---------------------------------------------------------------------------
describe('D3 submitting a report', () => {
  it('saves a bug, numbers it BUG-0001, and emails the default recipient after the response', async () => {
    let release;
    fakes.gmail.hold = new Promise((r) => { release = r; });
    const body = bug();
    const res = await call('/api/reports/submit', { token: teacher, body, drain: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: body.reportId, number: 'BUG-0001' });

    // The email was handed to ctx.waitUntil, not awaited into the response:
    // Gmail is being held open, yet the response has already arrived.
    expect(waitUntilPromises.length).toBeGreaterThan(0);
    expect((await report(body.reportId)).email.status).toBe('pending');
    release();
    await drainWaitUntil();

    const sends = gmailSends();
    expect(sends).toHaveLength(1);
    const raw = decodeGmailRaw(sends[0]);
    expect(headerOf(raw, 'To')).toBe('alvinmk06@gmail.com');
    expect(headerOf(raw, 'Reply-To')).toBe('zoe.teacher@harness.example');
    expect(decodeSubject(headerOf(raw, 'Subject')))
      .toBe('[Bug] BUG-0001 · Blocking · Zoë cannot join the evening class — p13-reports-teacher (Silver)');

    const saved = await report(body.reportId);
    expect(saved).toMatchObject({ type: 'bug', status: 'new', severity: 'blocking', number: 'BUG-0001' });
    expect(saved.submittedBy).toMatchObject({ uid: TEACHER, email: 'zoe.teacher@harness.example' });
    expect(saved.context).toMatchObject({ page: '/dashboard', tier: 'silver' });
    expect(saved.email).toMatchObject({ status: 'sent', attempts: 1, gmailId: 'gmail_1', recipient: 'alvinmk06@gmail.com' });
    const due = saved.responseDueAt.toMillis() - saved.createdAt.toMillis();
    expect(due).toBe(36 * 3600_000);
  });

  it('numbers features separately (FR-0001) with a "[Feature request]" subject', async () => {
    await submit(bug());
    const res = await submit(feature());
    expect(res.body.number).toBe('FR-0001');
    const second = await submit(bug());
    expect(second.body.number).toBe('BUG-0002');
    await drainWaitUntil();

    const subjects = gmailSends().map((s) => decodeSubject(headerOf(decodeGmailRaw(s), 'Subject')));
    expect(subjects.some((s) => s.startsWith('[Feature request] FR-0001 · Export attendance to Excel'))).toBe(true);
  });

  it('is idempotent on the report id: a retried submit returns the same report and sends once', async () => {
    const body = bug();
    const first = await submit(body);
    const again = await submit(body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, number: first.body.number });
    await drainWaitUntil();
    expect(gmailSends()).toHaveLength(1);
    expect((await db.collection('reports').get()).size).toBe(1);
  });

  it('refuses another teacher reusing someone else\'s report id', async () => {
    const body = bug();
    await submit(body);
    const res = await submit(body, other);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('report_id_taken');
  });

  it('validates per type (a feature has no severity; a bug needs one)', async () => {
    expect((await submit(bug({ severity: undefined }))).status).toBe(400);
    expect((await submit({ ...feature(), severity: 'blocking' })).status).toBe(400);
    expect((await submit(bug({ title: 'x' }))).status).toBe(400);
  });

  it('is for signed-in teachers only', async () => {
    expect((await call('/api/reports/submit', { body: bug() })).status).toBe(401);
    expect((await submit(bug(), noRole)).status).toBe(403);
  });

  it('limits a teacher to 10 reports an hour', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await submit(bug())).status).toBe(200);
    }
    const res = await submit(bug());
    expect(res.status).toBe(429);
    await drainWaitUntil();
  });

  it('"Your reports" lists only the caller\'s own, newest first', async () => {
    const a = bug();
    const b = feature();
    await submit(a);
    await submit(b);
    await submit(bug(), other);
    const res = await call('/api/reports/mine', { method: 'GET', token: teacher });
    expect(res.status).toBe(200);
    expect(res.body.reports.map((r) => r.id)).toEqual([b.reportId, a.reportId]);
    expect(res.body.reports[0]).toMatchObject({ type: 'feature', number: 'FR-0001', status: 'new' });
    await drainWaitUntil();
  });
});

// ---------------------------------------------------------------------------
describe('D4 delivery: failures, retries, keep-alive', () => {
  it('a Gmail 500 leaves the report saved and the email failed, then the sweep delivers it', async () => {
    fakes.gmail.fail = 500;
    const body = bug();
    expect((await submit(body)).status).toBe(200);
    await drainWaitUntil();

    let saved = await report(body.reportId);
    expect(saved.email).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'http_500' });
    expect(saved.email.nextAttemptAt.toMillis()).toBeGreaterThan(Date.now());

    // Not due yet: the sweep leaves it alone.
    fakes.gmail.fail = null;
    await sweep();
    expect((await report(body.reportId)).email.status).toBe('failed');

    await db.doc(`reports/${body.reportId}`).set({ email: { nextAttemptAt: new Date(Date.now() - 1000) } }, { merge: true });
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    saved = await report(body.reportId);
    expect(saved.email).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('invalid_grant is not retried and turns the Gmail card to "disconnected"', async () => {
    fakes.gmail.oauthError = 'invalid_grant';
    const body = bug();
    await submit(body);
    await drainWaitUntil();

    const saved = await report(body.reportId);
    // Terminal: out of the retry query until someone presses Resend.
    expect(saved.email).toMatchObject({ status: 'needs_attention', errorCode: 'invalid_grant' });
    expect(saved.email.nextAttemptAt).toBeNull();

    const card = await call('/api/admin/notifications', { token: superadmin, body: { action: 'get' } });
    expect(card.body.gmail).toMatchObject({ configured: true, disconnected: true });
    expect(card.body.gmail.lastError).toMatch(/disconnected/i);

    // Once Google works again (reconnected), the sweep still leaves it alone.
    fakes.gmail.oauthError = null;
    await sweep();
    expect((await report(body.reportId)).email.status).toBe('needs_attention');
  });

  it('the sweep sends a pending email only after a two-minute grace (no race with the submit)', async () => {
    const fresh = randomUUID();
    const stale = randomUUID();
    const base = { type: 'bug', number: 'BUG-0009', title: 't', description: 'd', severity: 'cosmetic',
      submittedBy: { uid: TEACHER, email: 'zoe.teacher@harness.example' }, responseDueAt: new Date(),
      email: { status: 'pending', attempts: 0 } };
    await db.doc(`reports/${fresh}`).set({ ...base, createdAt: new Date() });
    await db.doc(`reports/${stale}`).set({ ...base, createdAt: new Date(Date.now() - 5 * 60_000) });

    const res = await sweep();
    expect(res.body.sent).toBe(1);
    expect((await report(stale)).email.status).toBe('sent');
    expect((await report(fresh)).email.status).toBe('pending');
  });

  it('gives up after 8 attempts', async () => {
    const id = randomUUID();
    await db.doc(`reports/${id}`).set({
      type: 'bug', number: 'BUG-0001', title: 't', description: 'd', severity: 'cosmetic',
      submittedBy: { uid: TEACHER }, responseDueAt: new Date(), createdAt: new Date(Date.now() - 86_400_000),
      email: { status: 'failed', attempts: 8, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await sweep();
    expect(gmailSends()).toHaveLength(0);
  });

  it('stops before the subrequest budget runs out, counting Gmail calls too', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    for (let i = 0; i < 3; i += 1) {
      await db.doc(`reports/${randomUUID()}`).set({
        type: 'bug', number: `BUG-000${i + 1}`, title: 't', description: 'd', severity: 'cosmetic',
        submittedBy: { uid: TEACHER }, responseDueAt: new Date(), createdAt: old,
        email: { status: 'pending', attempts: 0 },
      });
    }
    // Measured: the first send costs 5 Firestore calls + 2 to Google (token,
    // send), later ones 4 + 1; the sweep wants 8 + 2 in hand before each. At
    // 21 that allows two sends. With Google calls uncounted it would see room
    // for a third — the bug this guards against.
    const previous = process.env.SUBREQUEST_BUDGET;
    process.env.SUBREQUEST_BUDGET = '21';
    try {
      const res = await sweep();
      expect(res.body.sent).toBe(2);
      expect(res.body.deferred).toBe(1);
      // Per-invocation since Phase 13 / 08 C9, so read from the response.
      expect(res.body.subrequests).toBeLessThanOrEqual(21);
    } finally {
      process.env.SUBREQUEST_BUDGET = previous;
    }
  });

  it('the ten-minute trigger runs mpesaReconcile and then notificationsSweep in one invocation', async () => {
    const worker = await loadWorker();
    const background = [];
    await worker.scheduled({ cron: '*/10 * * * *' }, {}, { waitUntil: (p) => background.push(p) });
    await Promise.allSettled(background);
    // The keep-alive is notificationsSweep's observable when nothing is queued.
    expect(tokenExchanges()).toHaveLength(1);
    const settings = (await db.doc('config/notifications').get()).data();
    expect(settings?.gmail?.lastTokenCheckAt).toBeTruthy();
  });

  it('exchanges the Gmail token once a week even with no reports (keep-alive)', async () => {
    const first = await sweep();
    expect(first.body.tokenChecked).toBe('ok');
    expect(tokenExchanges()).toHaveLength(1);
    expect(gmailSends()).toHaveLength(0);
    const settings = (await db.doc('config/notifications').get()).data();
    expect(settings.gmail.lastTokenCheckAt.toMillis()).toBeGreaterThan(Date.now() - 60_000);

    const before = tokenExchanges().length;
    const second = await sweep();
    expect(second.body.tokenChecked).toBeNull();
    expect(tokenExchanges().length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('D7 superadmin: recipient, test email, inboxes', () => {
  it('changing the recipient redirects the next alert, and is audited', async () => {
    const set = await call('/api/admin/notifications', {
      token: superadmin, body: { action: 'setRecipient', email: 'New.Owner@Example.com' },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.reportRecipient).toBe('new.owner@example.com');

    await submit(bug());
    await drainWaitUntil();
    expect(headerOf(decodeGmailRaw(gmailSends()[0]), 'To')).toBe('new.owner@example.com');

    const audits = await db.collection('audit').where('action', '==', 'notifications.recipient_changed').get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().before).toEqual({ reportRecipient: 'alvinmk06@gmail.com' });
  });

  it('refuses an invalid recipient', async () => {
    const res = await call('/api/admin/notifications', { token: superadmin, body: { action: 'setRecipient', email: 'not-an-email' } });
    expect(res.status).toBe(400);
  });

  it('"Send test email" sends to the current recipient and reports the outcome', async () => {
    const ok = await call('/api/admin/notifications', { token: superadmin, body: { action: 'sendTest' } });
    expect(ok.body).toMatchObject({ sent: true });
    expect(decodeSubject(headerOf(decodeGmailRaw(gmailSends()[0]), 'Subject'))).toBe('Test alert from Online Tutoring');

    fakes.gmail.fail = 403;
    const bad = await call('/api/admin/notifications', { token: superadmin, body: { action: 'sendTest' } });
    expect(bad.body).toMatchObject({ sent: false, code: 'http_403' });
  });

  it('teachers cannot reach the superadmin endpoints', async () => {
    expect((await call('/api/admin/notifications', { token: teacher, body: { action: 'get' } })).status).toBe(403);
    expect((await call('/api/admin/reports', { token: teacher, body: { action: 'list', type: 'bug' } })).status).toBe(403);
  });

  it('lists one inbox per type with status counts, and pages with a cursor', async () => {
    const t0 = Date.now() - 3_600_000;
    for (let i = 0; i < 22; i += 1) {
      await db.doc(`reports/${randomUUID()}`).set({
        type: 'bug', number: `BUG-${String(i + 1).padStart(4, '0')}`, title: `Bug ${i + 1}`, description: 'd',
        severity: 'annoying', status: i < 2 ? 'resolved' : 'new', submittedBy: { uid: TEACHER },
        createdAt: new Date(t0 + i * 1000), responseDueAt: new Date(), email: { status: 'sent' },
      });
    }
    await db.doc(`reports/${randomUUID()}`).set({
      type: 'feature', number: 'FR-0001', title: 'F', description: 'd', urgency: 'soon', status: 'new',
      submittedBy: { uid: TEACHER }, createdAt: new Date(), responseDueAt: new Date(), email: { status: 'sent' },
    });

    const page1 = await call('/api/admin/reports', { token: superadmin, body: { action: 'list', type: 'bug' } });
    expect(page1.status, JSON.stringify(page1.body)).toBe(200);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items[0].number).toBe('BUG-0022');
    expect(page1.body.counts).toMatchObject({ new: 20, resolved: 2, wont_fix: 0 });
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await call('/api/admin/reports', {
      token: superadmin, body: { action: 'list', type: 'bug', cursor: page1.body.nextCursor },
    });
    expect(page2.body.items.map((r) => r.number)).toEqual(['BUG-0002', 'BUG-0001']);
    expect(page2.body.nextCursor).toBeNull();

    const resolved = await call('/api/admin/reports', { token: superadmin, body: { action: 'list', type: 'bug', status: 'resolved' } });
    expect(resolved.body.items).toHaveLength(2);

    const features = await call('/api/admin/reports', { token: superadmin, body: { action: 'list', type: 'feature' } });
    expect(features.body.items.map((r) => r.number)).toEqual(['FR-0001']);
    expect(Object.keys(features.body.counts)).toEqual(['new', 'reviewing', 'quoted', 'accepted', 'declined', 'shipped']);
  });

  it('status follows the report type\'s workflow; notes are kept; both audited/persisted', async () => {
    const body = feature();
    await submit(body);
    await drainWaitUntil();

    const wrong = await call('/api/admin/reports', { token: superadmin, body: { action: 'setStatus', id: body.reportId, status: 'resolved' } });
    expect(wrong.status).toBe(400);
    const ok = await call('/api/admin/reports', { token: superadmin, body: { action: 'setStatus', id: body.reportId, status: 'quoted' } });
    expect(ok.status).toBe(200);
    await call('/api/admin/reports', { token: superadmin, body: { action: 'addNote', id: body.reportId, text: 'Quoted KES 4,000' } });

    const saved = await report(body.reportId);
    expect(saved.status).toBe('quoted');
    expect(saved.internalNotes).toHaveLength(1);
    expect(saved.internalNotes[0]).toMatchObject({ by: SUPER, text: 'Quoted KES 4,000' });

    const got = await call('/api/admin/reports', { token: superadmin, body: { action: 'get', id: body.reportId } });
    expect(got.body.report).toMatchObject({ status: 'quoted', problem: 'I copy it by hand every month.' });
    expect(got.body.report.internalNotes[0].text).toBe('Quoted KES 4,000');
  });

  it('"Resend email" sends again on demand', async () => {
    fakes.gmail.fail = 500;
    const body = bug();
    await submit(body);
    await drainWaitUntil();
    fakes.gmail.fail = null;
    const res = await call('/api/admin/reports', { token: superadmin, body: { action: 'resendEmail', id: body.reportId } });
    expect(res.body).toMatchObject({ ok: true, sent: true });
    expect((await report(body.reportId)).email.status).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
describe('D2 screenshots', () => {
  const upload = (reportId, index, variant, data, token = teacher, contentType = 'image/webp') =>
    call('/api/reports/attachment', { token, body: { reportId, index, variant, contentType, data, width: 1, height: 1 } });

  it('uploads full + thumbnail, attaches them on submit, and the upload record is cleared', async () => {
    const body = bug();
    expect((await upload(body.reportId, 0, 'full', webp(1))).status).toBe(200);
    expect((await upload(body.reportId, 0, 'thumb', webp(2))).status).toBe(200);
    expect((await upload(body.reportId, 1, 'full', PNG, teacher, 'image/png'))).toMatchObject({ status: 200 });

    expect([...fakes.storage.objects.keys()].sort()).toEqual([
      `reports/${body.reportId}/0-thumb.webp`, `reports/${body.reportId}/0.webp`, `reports/${body.reportId}/1.png`,
    ]);

    const res = await submit({ ...body, attachments: [{ index: 0 }, { index: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await drainWaitUntil();

    const saved = await report(body.reportId);
    expect(saved.attachments).toEqual([
      expect.objectContaining({ index: 0, path: `reports/${body.reportId}/0.webp`, thumbPath: `reports/${body.reportId}/0-thumb.webp` }),
      expect.objectContaining({ index: 1, path: `reports/${body.reportId}/1.png`, thumbPath: null }),
    ]);
    expect((await db.doc(`reportUploads/${body.reportId}`).get()).exists).toBe(false);

    // The email links to the viewer; it never carries the images.
    const raw = decodeGmailRaw(gmailSends()[0]);
    expect(raw).not.toMatch(/Content-Disposition: attachment/i);

    // The superadmin sees short-lived signed URLs.
    const got = await call('/api/admin/reports', { token: superadmin, body: { action: 'get', id: body.reportId } });
    expect(got.body.report.attachments[0].url).toMatch(new RegExp(`/reports/${body.reportId}/0\\.webp\\?.*Expires=`));
    expect(got.body.report.attachments[0].thumbUrl).toMatch(/0-thumb\.webp/);

    // Nothing more can be added once it is sent.
    const late = await upload(body.reportId, 2, 'full', webp(3));
    expect(late.status).toBe(409);
  });

  it('a real-size screenshot (~180 KB) fits under the 256 KB body cap', async () => {
    const big = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), randomBytesish(180_000)]);
    const res = await upload(randomUUID(), 0, 'full', big.toString('base64'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.bytes).toBe(big.length);
  });

  it('a body over 256 KB gets 413', async () => {
    const huge = Buffer.alloc(200_000, 1).toString('base64');
    const res = await upload(randomUUID(), 0, 'full', huge);
    expect(res.status).toBe(413);
  });

  it('a fourth image is refused', async () => {
    const res = await upload(randomUUID(), 3, 'full', webp(1));
    expect(res.status).toBe(400);
    expect(fakes.storage.objects.size).toBe(0);
  });

  // Ruling (phase 06): the plan expected a PNG declared as WebP to pass. The
  // project-wide sniffer refuses ANY declared/actual mismatch (shared with the
  // WhatsApp upload), and the browser declares the encoded blob's real type —
  // so the stricter rule stays and only an honest PNG is stored as .png.
  it('a declared type that does not match the bytes is refused; honest PNG is stored as .png', async () => {
    const id = randomUUID();
    const lying = await upload(id, 0, 'full', PNG, teacher, 'image/webp');
    expect(lying.status).toBe(400);
    const honest = await upload(id, 0, 'full', PNG, teacher, 'image/png');
    expect(honest.status).toBe(200);
    expect([...fakes.storage.objects.keys()]).toEqual([`reports/${id}/0.png`]);
    expect(fakes.storage.objects.get(`reports/${id}/0.png`).contentType).toBe('image/png');
  });

  it('an SVG (script-capable) disguised as a PNG is refused', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const res = await upload(randomUUID(), 0, 'full', svg, teacher, 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_file');
  });

  it('the bytes decide: a PDF renamed .webp is refused', async () => {
    const res = await upload(randomUUID(), 0, 'full', PDF);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_file');
    expect(fakes.storage.objects.size).toBe(0);
  });

  it('another teacher cannot write into a report id already in use', async () => {
    const id = randomUUID();
    await upload(id, 0, 'full', webp(1));
    const res = await upload(id, 1, 'full', webp(2), other);
    expect(res.status).toBe(403);
  });

  it('the same image twice is stored once', async () => {
    const id = randomUUID();
    await upload(id, 0, 'full', webp(5));
    const dup = await upload(id, 1, 'full', webp(5));
    expect(dup.body).toMatchObject({ duplicate: true, index: 0 });
    expect(fakes.storage.objects.size).toBe(1);
  });

  it('screenshots removed in the form before sending are deleted from Storage', async () => {
    const body = bug();
    await upload(body.reportId, 0, 'full', webp(1));
    await upload(body.reportId, 1, 'full', webp(2));
    await upload(body.reportId, 1, 'thumb', webp(3));
    const res = await submit({ ...body, attachments: [{ index: 0 }] });
    expect(res.status).toBe(200);
    await drainWaitUntil();
    expect([...fakes.storage.objects.keys()]).toEqual([`reports/${body.reportId}/0.webp`]);
  });

  it('a submit cannot claim a screenshot that was never uploaded', async () => {
    const body = bug();
    await upload(body.reportId, 0, 'full', webp(1));
    const res = await submit({ ...body, attachments: [{ index: 0 }, { index: 2 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('attachments_missing');
    expect((await db.doc(`reports/${body.reportId}`).get()).exists).toBe(false);
  });

  it('screenshots for a report never submitted are purged after 24 h', async () => {
    const id = randomUUID();
    await upload(id, 0, 'full', webp(1));
    await upload(id, 0, 'thumb', webp(2));
    expect(fakes.storage.objects.size).toBe(2);

    const keep = randomUUID();
    await upload(keep, 0, 'full', webp(3));

    await db.doc(`reportUploads/${id}`).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }, { merge: true });
    const res = await sweep();
    expect(res.body.purged).toBe(1);
    expect([...fakes.storage.objects.keys()]).toEqual([`reports/${keep}/0.webp`]);
    expect((await db.doc(`reportUploads/${id}`).get()).exists).toBe(false);
    expect((await db.doc(`reportUploads/${keep}`).get()).exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The superadmin can delete a report: the document, its screenshots and any
// staged uploads go; the audit keeps its number and title.
describe('superadmin deletes a report', () => {
  const upload = (reportId, index, variant, data, token = teacher, contentType = 'image/webp') =>
    call('/api/reports/attachment', { token, body: { reportId, index, variant, contentType, data, width: 1, height: 1 } });
  const del = (id, token = superadmin) => call('/api/admin/reports', { token, body: { action: 'delete', id } });

  it('removes the report, its screenshots and the staged uploads, and audits it', async () => {
    const body = bug();
    await upload(body.reportId, 0, 'full', webp(11));
    await upload(body.reportId, 0, 'thumb', webp(12));
    expect((await submit({ ...body, attachments: [{ index: 0 }] })).status).toBe(200);
    await drainWaitUntil();
    const { number, title } = await report(body.reportId);
    expect(fakes.storage.objects.size).toBe(2);

    const res = await del(body.reportId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, filesRemoved: 2 });
    expect((await db.doc(`reports/${body.reportId}`).get()).exists).toBe(false);
    expect(fakes.storage.objects.size).toBe(0);

    await drainWaitUntil();
    const audits = await db.collection('audit').where('action', '==', 'reports.deleted').get();
    expect(audits.docs.map((d) => d.data().before)).toEqual([expect.objectContaining({ number, title, type: 'bug' })]);

    // Gone from the inbox.
    const list = await call('/api/admin/reports', { token: superadmin, body: { action: 'list', type: 'bug' } });
    expect(list.body.items.map((r) => r.id)).not.toContain(body.reportId);
  });

  it('removes screenshots that were uploaded but never submitted', async () => {
    // A staged upload left behind for this report id (e.g. a slot uploaded and
    // then dropped before submitting) is cleaned up with the report.
    const body = bug();
    await upload(body.reportId, 0, 'full', webp(31));
    expect((await submit({ ...body, attachments: [{ index: 0 }] })).status).toBe(200);
    await drainWaitUntil();
    await db.doc(`reportUploads/${body.reportId}`).set({
      uid: 'p13-reports-teacher', files: { 1: { fullPath: `reports/${body.reportId}/1.webp` } },
    });
    fakes.storage.objects.set(`reports/${body.reportId}/1.webp`, { contentType: 'image/webp', bytes: 10 });

    expect((await del(body.reportId)).body.filesRemoved).toBe(2);
    expect(fakes.storage.objects.size).toBe(0);
    expect((await db.doc(`reportUploads/${body.reportId}`).get()).exists).toBe(false);
  });

  it('feature requests too; a second delete is a clean 404', async () => {
    const body = feature();
    expect((await submit(body)).status).toBe(200);
    await drainWaitUntil();
    expect((await del(body.reportId)).status).toBe(200);
    expect((await del(body.reportId)).status).toBe(404);
  });

  it('only the superadmin can delete', async () => {
    const body = bug();
    expect((await submit(body)).status).toBe(200);
    await drainWaitUntil();
    expect((await del(body.reportId, teacher)).status).toBe(403);
    expect((await db.doc(`reports/${body.reportId}`).get()).exists).toBe(true);
  });

  it('a screenshot that cannot be deleted does not block the delete', async () => {
    const body = bug();
    await upload(body.reportId, 0, 'full', webp(21));
    expect((await submit({ ...body, attachments: [{ index: 0 }] })).status).toBe(200);
    await drainWaitUntil();
    fakes.storage.fail = 500;
    const res = await del(body.reportId);
    fakes.storage.fail = null;
    expect(res.status).toBe(200);
    expect((await db.doc(`reports/${body.reportId}`).get()).exists).toBe(false);
  });
});
