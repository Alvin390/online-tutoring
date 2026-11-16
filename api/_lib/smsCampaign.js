import { FieldValue } from './firebaseAdmin.js';
import { ApiError, badRequest, notFound } from './errors.js';
import { renderTemplate } from './messageTemplate.js';
import { resolveRecipients } from './messageRecipients.js';
import {
  normalizeSmsText, unsupportedChars, smsLength, smsUnits, smsCost, SMS_MAX_CHARS, SMS_MAX_UNITS, smsPlainValue as plainValue,
} from './smsText.js';
import { sendSms, smsStatus, SmsError, smsAvailable } from './sms.js';
import { recordSmsBalance, recordSmsUsage, lastKnownBalance, SMS_RESERVE_KES, smsAlertRecipient } from './smsCredit.js';
import { gmailConfigured, sendGmail } from './gmail.js';

/**
 * SMS messages to parents — 008Fixes / 07 (owner, 2026-11-14/15).
 *
 * A message is written once with placeholders and filled in PER PARENT here
 * (HashBack cannot fill our own text per person — checked 2026-11-15), then
 * sent one `/sms/send` per parent. That also gives every parent their own
 * HashBack id, which per-person delivery needs.
 *
 *   sms/campaigns/items/{id}                 the message, audience, counts
 *   sms/campaigns/items/{id}/recipients/{s}__{digits}   one parent: text, units, status, id
 *
 * Statuses: queued → sending → sent → delivered | failed; skipped (cancelled).
 *
 * The limits are checked HERE, on every parent's own version: at most two SMS
 * (336 plain characters), no emoji or other characters SMS can't carry in the
 * teacher's text (names are made plain: decorative fonts read as letters, the
 * rest dropped), and bulk sending stops above a KES 100 reserve so check-in
 * codes keep working.
 *
 * Sending is driven by the dashboard, a chunk of SMS_CHUNK at a time (as bulk
 * actions are): every request stays short and inside the Worker's subrequest
 * budget, and HashBack's ~100 a minute is respected by its own
 * RATE_LIMITED + Retry-After, which pauses the chunk and tells the dashboard
 * when to carry on.
 */

export const SMS_CHUNK = 20;
const SEND_CONCURRENCY = 5;
export const DELIVERY_WINDOW_MS = 30 * 60_000;
const STALE_SENDING_MS = 5 * 60_000;
const PENDING_DOC = 'config/smsPending';

export const campaignsCol = (db) => db.collection('sms/campaigns/items');
export const recipientKey = (session, phone) => `${session}__${String(phone).replace(/\D/g, '')}`;

/** One parent's message, as it will be sent. */
export function renderSms(template, recipient, schoolName) {
  const safe = {
    ...recipient,
    studentName: recipient.studentName == null ? null : plainValue(recipient.studentName),
    class: recipient.class == null ? null : plainValue(recipient.class),
    sessionName: recipient.sessionName == null ? null : plainValue(recipient.sessionName),
    schoolName: plainValue(schoolName ?? ''),
  };
  return normalizeSmsText(renderTemplate(template, safe)).trim();
}

/**
 * Every parent's version, checked. Throws a 400 naming the problem:
 * the teacher's own text has a character SMS can't carry, or the LONGEST
 * parent's version is over two SMS (it names that student).
 */
export function prepareMessages(template, recipients, schoolName) {
  const text = String(template ?? '').trim();
  if (!text) throw badRequest('Write a message first.', 'empty_message');
  const bad = unsupportedChars(text.replace(/\{\{[^}]*\}\}/g, ''));
  if (bad.length) {
    throw new ApiError(400, 'unsupported_characters',
      `SMS can't carry ${bad.length === 1 ? 'this character' : 'these characters'}: ${bad.join(' ')}. Emoji can't be sent by SMS.`);
  }
  let longest = null;
  const messages = recipients.map((r) => {
    const body = renderSms(text, r, schoolName);
    const length = smsLength(body);
    const item = { ...r, text: body, length, units: smsUnits(length) };
    if (!longest || length > longest.length) longest = item;
    return item;
  });
  if (longest && longest.length > SMS_MAX_CHARS) {
    const err = new ApiError(400, 'too_long',
      `Too long for ${SMS_MAX_UNITS} SMS for ${longest.studentName ?? 'one parent'}: shorten it by ${longest.length - SMS_MAX_CHARS} character${longest.length - SMS_MAX_CHARS === 1 ? '' : 's'}.`);
    err.detail = { studentName: longest.studentName ?? null, length: longest.length, over: longest.length - SMS_MAX_CHARS };
    throw err;
  }
  const units = messages.reduce((n, m) => n + m.units, 0);
  return {
    messages,
    units,
    cost: smsCost(units),
    longest: longest ? { studentName: longest.studentName ?? null, length: longest.length, units: longest.units, text: longest.text } : null,
  };
}

/** The people a filter reaches (opted-out, unapproved and — unless asked — staff left out). */
export const smsRecipients = (db, filter) => resolveRecipients(db, filter);

/** Refuses when sending `cost` would take the wallet below the reserve; emails the owner once per top-up. */
export async function assertAboveReserve(db, cost, log) {
  const balance = await lastKnownBalance(db);
  if (balance == null) return null; // never seen: HashBack refuses on its own if empty
  if (balance - cost >= SMS_RESERVE_KES) return balance;
  await alertReserve(db, balance, log);
  // 009Fixes / 00: no amounts for teachers (the school pays); the owner's
  // email below carries the figures.
  const err = new ApiError(402, 'low_credit',
    'SMS credit is low right now. Sending is paused so check-in codes keep working. The owner has been told.');
  throw err;
}

async function alertReserve(db, balance, log) {
  try {
    const ref = db.doc('config/smsBalance');
    const send = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const since = data.topUpAt?.toMillis?.() ?? 0;
      const last = data.alertedReserveAt?.toMillis?.() ?? 0;
      if (last && last >= since) return false;
      tx.set(ref, { alertedReserveAt: new Date() }, { merge: true });
      return true;
    });
    if (!send || !gmailConfigured()) return;
    const to = await smsAlertRecipient(db);
    if (!to) return;
    await sendGmail({
      to,
      subject: 'SMS paused: credit at the reserve',
      text: `A teacher's SMS was paused: the wallet has KES ${balance.toFixed(2)}, and KES ${SMS_RESERVE_KES} is kept so check-in codes keep working.\n\nPlease top up (HashBack dashboard → SMS → Top up).`,
    });
  } catch (err) {
    log?.warn?.('SMS reserve alert not sent', { code: err?.code });
  }
}

/** Creates a campaign and its recipients (status queued). */
export async function createCampaign({ db, user, kind, template, filter, title, schoolName, prepared }) {
  const ref = campaignsCol(db).doc();
  await ref.set({
    kind, // 'campaign' | 'one'
    title: title ?? null,
    template,
    filter: filter ?? null,
    schoolName: schoolName ?? null,
    recipientCount: prepared.messages.length,
    units: prepared.units,
    cost: prepared.cost,
    status: 'sending',
    counts: { queued: prepared.messages.length, sent: 0, delivered: 0, failed: 0, skipped: 0 },
    createdBy: user.uid,
    createdByEmail: user.email ?? null,
    createdAt: FieldValue.serverTimestamp(),
    lastSentAt: null,
  });
  for (let i = 0; i < prepared.messages.length; i += 400) {
    const batch = db.batch();
    prepared.messages.slice(i, i + 400).forEach((m, offset) => {
      batch.set(ref.collection('recipients').doc(recipientKey(m.session, m.phone)), {
        phone: m.phone,
        session: m.session,
        sessionName: m.sessionName ?? null,
        studentName: m.studentName ?? null,
        staff: m.staff === true,
        text: m.text,
        units: m.units,
        status: 'queued',
        order: i + offset,
        smsId: null,
        error: null,
        sentAt: null,
        statusAt: null,
      });
    });
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
  return ref;
}

/** Runs `fn` over `items`, `limit` at a time, stopping early when `stop()` says so. */
async function pool(items, limit, fn, stop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const item = items[next];
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function addPending(db, campaignId, untilMs) {
  await db.doc(PENDING_DOC).set({ items: { [campaignId]: untilMs } }, { merge: true });
}

/**
 * Sends the next chunk of a campaign. Recipients are CLAIMED first (queued →
 * sending, in one transaction), so two overlapping calls never send to the
 * same parent twice. Returns what happened and whether to carry on.
 */
export async function sendChunk({ db, user, campaignId, log, nowMs = Date.now() }) {
  const ref = campaignsCol(db).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('That message no longer exists.');
  const campaign = snap.data();
  if (campaign.status === 'cancelled') return { done: true, cancelled: true, counts: campaign.counts };
  if (!smsAvailable()) throw new ApiError(503, 'sms_unavailable', 'SMS is not available right now. Please try again later.');

  // Interrupted sends older than 5 minutes: HashBack may or may not have
  // sent them, so they are marked failed (never sent twice silently).
  const stale = await ref.collection('recipients').where('status', '==', 'sending').get();
  const staleFails = stale.docs.filter((d) => (d.data().claimedAt?.toMillis?.() ?? 0) < nowMs - STALE_SENDING_MS);

  const queuedSnap = await ref.collection('recipients').where('status', '==', 'queued').limit(SMS_CHUNK).get();
  const batchDocs = queuedSnap.docs.sort((a, b) => a.data().order - b.data().order);
  if (batchDocs.length === 0 && staleFails.length === 0) {
    const finished = stale.empty;
    if (finished && campaign.status === 'sending') await ref.set({ status: 'sent' }, { merge: true });
    return { done: finished, sent: 0, failed: 0, counts: campaign.counts };
  }

  const chunkCost = smsCost(batchDocs.reduce((n, d) => n + (d.data().units ?? 1), 0));
  await assertAboveReserve(db, chunkCost, log);

  // Claim.
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await Promise.all(batchDocs.map((d) => tx.get(d.ref)));
    const mine = fresh.filter((d) => d.exists && d.data().status === 'queued');
    mine.forEach((d) => tx.update(d.ref, { status: 'sending', claimedAt: new Date(nowMs) }));
    return mine.map((d) => ({ ref: d.ref, ...d.data() }));
  });

  const results = [];
  let retryAfter = null;
  let outOfCredit = false;
  let lastBalance = null;
  await pool(claimed, SEND_CONCURRENCY, async (r) => {
    try {
      const sent = await sendSms({ to: r.phone, message: r.text });
      if (Number.isFinite(sent.balance)) lastBalance = sent.balance;
      results.push({ r, status: 'sent', smsId: sent.id, units: sent.units || r.units, cost: sent.cost || smsCost(r.units) });
    } catch (err) {
      const code = err instanceof SmsError ? err.code : 'error';
      if (code === 'RATE_LIMITED') { retryAfter = err.retryAfter ?? 30; results.push({ r, status: 'queued' }); return; }
      if (code === 'INSUFFICIENT_FUNDS') { outOfCredit = true; results.push({ r, status: 'queued' }); return; }
      if (code === 'network_error' || code === 'sms_unavailable' || /^http_5/.test(code)) {
        results.push({ r, status: 'queued' }); retryAfter = retryAfter ?? 15; return;
      }
      results.push({ r, status: 'failed', error: code });
    }
  }, () => retryAfter != null || outOfCredit);
  // Anything claimed but not attempted (the pool stopped early) goes back.
  const attempted = new Set(results.map((x) => x.r.ref.path));
  for (const r of claimed) if (!attempted.has(r.ref.path)) results.push({ r, status: 'queued' });

  const now = new Date(nowMs);
  const sent = results.filter((x) => x.status === 'sent');
  const failed = results.filter((x) => x.status === 'failed');
  const requeued = results.filter((x) => x.status === 'queued');
  const units = sent.reduce((n, x) => n + x.units, 0);
  const cost = Math.round(sent.reduce((n, x) => n + x.cost, 0) * 100) / 100;

  const batch = db.batch();
  for (const x of sent) batch.update(x.r.ref, { status: 'sent', smsId: x.smsId, sentAt: now, statusAt: now, error: null });
  for (const x of failed) batch.update(x.r.ref, { status: 'failed', error: x.error, statusAt: now });
  for (const x of requeued) batch.update(x.r.ref, { status: 'queued', claimedAt: FieldValue.delete() });
  for (const d of staleFails) batch.update(d.ref, { status: 'failed', error: 'interrupted', statusAt: now });
  batch.update(ref, {
    'counts.queued': FieldValue.increment(-(sent.length + failed.length + staleFails.length)),
    'counts.sent': FieldValue.increment(sent.length),
    'counts.failed': FieldValue.increment(failed.length + staleFails.length),
    sentUnits: FieldValue.increment(units),
    sentCost: FieldValue.increment(cost),
    ...(sent.length ? { lastSentAt: now } : {}),
  });
  await batch.commit();

  if (sent.length) await addPending(db, campaignId, nowMs + DELIVERY_WINDOW_MS);
  await Promise.all([
    lastBalance != null ? recordSmsBalance(lastBalance, { db, log }) : null,
    recordSmsUsage({ db, uid: user.uid, email: user.email ?? null, units, cost, log }),
  ]);

  const after = (await ref.get()).data();
  const remaining = after.counts?.queued ?? 0;
  if (remaining <= 0 && after.status === 'sending') await ref.set({ status: 'sent' }, { merge: true });
  if (outOfCredit) {
    await ref.set({ status: 'paused_low_credit' }, { merge: true });
    throw new ApiError(402, 'low_credit', 'SMS credit has run out. The owner has been told; the rest will send after a top-up.');
  }
  return {
    done: remaining <= 0,
    sent: sent.length,
    failed: failed.length + staleFails.length,
    remaining,
    retryAfter,
    counts: after.counts,
  };
}

const HASHBACK_DELIVERED = new Set(['delivered']);
const HASHBACK_FAILED = new Set(['failed', 'rejected', 'expired', 'blacklisted']);

/**
 * Asks HashBack what happened to up to `limit` sent messages of a campaign
 * and records it. Returns how many are still waiting for a report.
 */
export async function checkDelivery({ db, campaignId, limit = 12, log }) {
  const ref = campaignsCol(db).doc(campaignId);
  const waiting = await ref.collection('recipients').where('status', '==', 'sent').limit(limit).get();
  if (waiting.empty) return { waiting: 0, delivered: 0, failed: 0 };
  let delivered = 0;
  let failed = 0;
  const batch = db.batch();
  const now = new Date();
  for (const doc of waiting.docs) {
    const { smsId } = doc.data();
    if (!smsId) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const reply = await smsStatus(smsId);
      // HashBack's reply (seen on the first real send, 2026-11-16):
      //   { success, sms: { status: 'delivered', dlr_status, refunded, error, … } }
      // The top-level form is kept as a fallback.
      const report = reply.sms ?? reply.message ?? reply;
      const status = String(report.status ?? report.dlr_status ?? '').toLowerCase();
      if (HASHBACK_DELIVERED.has(status)) {
        delivered += 1;
        batch.update(doc.ref, { status: 'delivered', statusAt: now, providerStatus: status });
      } else if (HASHBACK_FAILED.has(status)) {
        failed += 1;
        batch.update(doc.ref, {
          status: 'failed', statusAt: now, providerStatus: status, error: report.error ? String(report.error).slice(0, 80) : status,
          refunded: report.refunded === true,
        });
      }
    } catch (err) {
      log?.warn?.('SMS status not read', { code: err?.code });
    }
  }
  if (delivered || failed) {
    batch.update(ref, {
      'counts.sent': FieldValue.increment(-(delivered + failed)),
      'counts.delivered': FieldValue.increment(delivered),
      'counts.failed': FieldValue.increment(failed),
      deliveryCheckedAt: now,
    });
  } else {
    batch.update(ref, { deliveryCheckedAt: now });
  }
  await batch.commit();
  return { waiting: waiting.size - delivered - failed, delivered, failed };
}

/**
 * The every-minute delivery round (no new cron: it rides on the
 * scheduled-blocks trigger). Only campaigns sent in the last 30 minutes are
 * checked; with none, it costs one read.
 */
export async function deliverySweep({ db, nowMs = Date.now(), log, perCampaign = 12, maxCampaigns = 3 }) {
  const pendingRef = db.doc(PENDING_DOC);
  const snap = await pendingRef.get();
  const items = snap.exists ? (snap.data().items ?? {}) : {};
  const ids = Object.keys(items);
  if (ids.length === 0) return { checked: 0 };
  const done = {};
  let checked = 0;
  for (const id of ids.slice(0, maxCampaigns)) {
    if (!(items[id] > nowMs)) { done[id] = FieldValue.delete(); continue; }
    // eslint-disable-next-line no-await-in-loop
    const r = await checkDelivery({ db, campaignId: id, limit: perCampaign, log });
    checked += 1;
    if (r.waiting === 0) {
      // eslint-disable-next-line no-await-in-loop
      const left = await campaignsCol(db).doc(id).collection('recipients').where('status', '==', 'sent').limit(1).get();
      if (left.empty) done[id] = FieldValue.delete();
    }
  }
  if (Object.keys(done).length) await pendingRef.set({ items: done }, { merge: true });
  return { checked, finished: Object.keys(done).length };
}

/** A campaign for the dashboard (dates as ISO). */
export function campaignView(id, data) {
  const iso = (v) => v?.toDate?.()?.toISOString?.() ?? null;
  return {
    id,
    kind: data.kind,
    title: data.title ?? null,
    template: data.template,
    filter: data.filter ?? null,
    recipientCount: data.recipientCount ?? 0,
    units: data.units ?? 0,
    // 009Fixes / 00: cost stays stored (the owner's tracking) but is not sent to teachers.
    status: data.status,
    counts: data.counts ?? {},
    createdAt: iso(data.createdAt),
    lastSentAt: iso(data.lastSentAt),
    deliveryCheckedAt: iso(data.deliveryCheckedAt),
    createdByEmail: data.createdByEmail ?? null,
  };
}

export function recipientView(id, data) {
  return {
    id,
    phoneEnding: String(data.phone ?? '').slice(-3),
    phone: data.phone,
    session: data.session,
    sessionName: data.sessionName ?? null,
    studentName: data.studentName ?? null,
    units: data.units ?? 1,
    status: data.status,
    error: data.error ?? null,
    refunded: data.refunded === true,
  };
}
