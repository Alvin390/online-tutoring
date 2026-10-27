import { createHandler } from '../_lib/handler.js';
import { getDb } from '../_lib/firebaseAdmin.js';
import { z } from '../_lib/validate.js';
import { tryWriteAudit } from '../_lib/audit.js';
import { gmailConfigured, sendGmail, GmailError } from '../_lib/gmail.js';
import { getNotificationSettings } from '../_lib/reports.js';
import { FieldValue } from '../_lib/firebaseAdmin.js';
import { classAlertRecipients, buildPreclassEmail, dashboardUrl } from '../_lib/preclassReminder.js';

/**
 * Where report alerts go, and whether Gmail is healthy — Phase 13 / 06 D7.
 *
 *   get           recipient + Gmail connection health
 *   setRecipient  change the address without a deploy (audited)
 *   sendTest      "Test alert from Online Tutoring" to the current recipient
 *
 * Before-class reminders — 002Fixes / 09 (see preclassReminder.js):
 *   setClassAlertRecipient    where they go (audited)
 *   resetClassAlertRecipient  back to the default: the teacher's login email
 *   setClassAlertsEnabled     on or off (audited)
 *   sendClassAlertTest        a sample reminder, automated notice included
 */

const schema = z
  .object({
    action: z.enum([
      'get', 'setRecipient', 'sendTest',
      'setClassAlertRecipient', 'resetClassAlertRecipient', 'setClassAlertsEnabled', 'sendClassAlertTest',
    ]),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const iso = (v) => v?.toDate?.()?.toISOString?.() ?? null;

function health(settings) {
  const g = settings.gmail ?? {};
  return {
    configured: gmailConfigured(),
    sender: gmailConfigured() ? process.env.GMAIL_SENDER : null,
    lastSuccessAt: iso(g.lastSuccessAt),
    lastTokenCheckAt: iso(g.lastTokenCheckAt),
    lastError: g.lastError ?? null,
    disconnected: g.disconnected === true,
  };
}

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'superadmin',
  schema,
  rateLimit: { bucket: 'admin_notifications', limit: 60, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const db = getDb();
    const ref = db.doc('config/notifications');
    const settings = await getNotificationSettings(db);

    /** What the card shows about class alerts: on/off, where, and why there. */
    const classAlerts = async (current) => {
      const { recipients, source } = await classAlertRecipients(current);
      return { enabled: current.classAlertsEnabled !== false, recipient: current.classAlertRecipient ?? null, recipients, source };
    };
    const audit = (action, before, after) => tryWriteAudit(
      { action, actor: user.uid, actorRole: user.role, target: 'config/notifications', before, after,
        context: { requestId: log.requestId } },
      log
    );

    if (body.action === 'get') {
      return { ok: true, reportRecipient: settings.reportRecipient, gmail: health(settings), classAlerts: await classAlerts(settings) };
    }

    if (body.action === 'setClassAlertRecipient') {
      if (!body.email) {
        const { badRequest } = await import('../_lib/errors.js');
        throw badRequest('Enter an email address.');
      }
      await ref.set({ classAlertRecipient: body.email, updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
      await audit('notifications.class_alert_recipient_changed', { classAlertRecipient: settings.classAlertRecipient ?? null }, { classAlertRecipient: body.email });
      return { ok: true, classAlerts: await classAlerts({ ...settings, classAlertRecipient: body.email }) };
    }

    if (body.action === 'resetClassAlertRecipient') {
      await ref.set({ classAlertRecipient: FieldValue.delete(), updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
      await audit('notifications.class_alert_recipient_changed', { classAlertRecipient: settings.classAlertRecipient ?? null }, { classAlertRecipient: null });
      return { ok: true, classAlerts: await classAlerts({ ...settings, classAlertRecipient: undefined }) };
    }

    if (body.action === 'setClassAlertsEnabled') {
      if (typeof body.enabled !== 'boolean') {
        const { badRequest } = await import('../_lib/errors.js');
        throw badRequest('Say whether class alerts are on or off.');
      }
      await ref.set({ classAlertsEnabled: body.enabled, updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
      await audit('notifications.class_alerts_toggled', { classAlertsEnabled: settings.classAlertsEnabled !== false }, { classAlertsEnabled: body.enabled });
      return { ok: true, classAlerts: await classAlerts({ ...settings, classAlertsEnabled: body.enabled }) };
    }

    if (body.action === 'sendClassAlertTest') {
      const { recipients } = await classAlertRecipients(settings);
      const email = buildPreclassEmail({
        sessionName: 'Evening Session', startLabel: '7:30 PM', minutesLeft: 60,
        counts: [['Form 3', 2], ['Grade 8', 1]], dashboardUrl: dashboardUrl(), test: true,
      });
      try {
        for (const to of recipients) await sendGmail({ to, ...email });
        return { ok: true, sent: true, message: `Test reminder sent to ${recipients.join(', ')}.` };
      } catch (err) {
        return { ok: true, sent: false, code: err instanceof GmailError ? err.code : 'unknown', message: err.message };
      }
    }

    if (body.action === 'setRecipient') {
      if (!body.email) {
        const { badRequest } = await import('../_lib/errors.js');
        throw badRequest('Enter an email address.');
      }
      await ref.set({ reportRecipient: body.email, updatedAt: new Date(), updatedBy: user.uid }, { merge: true });
      await tryWriteAudit(
        { action: 'notifications.recipient_changed', actor: user.uid, actorRole: user.role,
          target: 'config/notifications', before: { reportRecipient: settings.reportRecipient },
          after: { reportRecipient: body.email }, context: { requestId: log.requestId } },
        log
      );
      return { ok: true, reportRecipient: body.email };
    }

    // sendTest
    try {
      await sendGmail({
        to: settings.reportRecipient,
        subject: 'Test alert from Online Tutoring',
        text: `This is a test. Bug reports and feature requests will arrive at ${settings.reportRecipient} like this.\n\nIf this landed in Spam, mark it "Not spam" and add a filter (see the setup guide).`,
        html: `<p>This is a test. Bug reports and feature requests will arrive at <strong>${settings.reportRecipient}</strong> like this.</p><p style="color:#6b7280">If this landed in Spam, mark it "Not spam" and add a filter (see the setup guide).</p>`,
      });
      await ref.set({ gmail: { lastSuccessAt: new Date(), lastError: null, disconnected: false } }, { merge: true });
      return { ok: true, sent: true, message: `Test email sent to ${settings.reportRecipient}.` };
    } catch (err) {
      const code = err instanceof GmailError ? err.code : 'unknown';
      await ref.set(
        { gmail: { lastError: err.message, disconnected: code === 'invalid_grant' || code === 'not_configured', lastErrorAt: new Date() } },
        { merge: true }
      );
      return { ok: true, sent: false, code, message: err.message };
    }
  },
});
