import { createHandler } from '../_lib/handler.js';
import { getDb, FieldValue } from '../_lib/firebaseAdmin.js';
import { z, phoneSchema, sessionSchema } from '../_lib/validate.js';
import { postEntry, reverseEntry, PAYMENT_METHODS } from '../_lib/ledger.js';
import { shouldAutoUnblock } from '../_lib/feeState.js';
import { badRequest, notFound } from '../_lib/errors.js';
import { tryWriteAudit } from '../_lib/audit.js';

/**
 * Record a payment, adjustment or reversal — Phase 06 D3.
 *
 * This is the PRIMARY path, not a fallback. Most Kenyan tutors collect cash in
 * person or M-Pesa straight to their own phone, and the ledger is designed to
 * be completely functional with no on-platform payment at all — your explicit
 * constraint. Phase 09's Daraja integration adds exactly one more posting
 * source; it is never a prerequisite.
 */

const schema = z
  .object({
    session: sessionSchema,
    phone: phoneSchema,
    type: z.enum(['payment', 'invoice', 'adjustment', 'reversal']),
    amount: z.number().int().min(1).max(10_000_000).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
    occurredAt: z.string().datetime().optional(),
    reversesEntryId: z.string().trim().max(64).optional(),
    // Lets the teacher decide whether clearing a balance also lifts a block.
    autoUnblock: z.boolean().optional(),
  })
  .strict();

export default createHandler({
  method: 'POST',
  auth: true,
  role: 'teacher',
  tier: 'silver',
  schema,
  rateLimit: { bucket: 'fees_post', limit: 300, windowSeconds: 3600, keyBy: 'ip' },
  handle: async ({ body, user, log }) => {
    const { session, phone, type } = body;
    const db = getDb();

    // ---- Reversal takes a different shape: it names an entry, not an amount.
    if (type === 'reversal') {
      if (!body.reversesEntryId) throw badRequest('Which entry are you reversing?');
      if (!body.note) throw badRequest('A reason is required when reversing an entry.');

      const result = await reverseEntry({
        phone,
        session,
        entryId: body.reversesEntryId,
        reason: body.note,
        recordedBy: user.uid,
      });

      log.info('Ledger entry reversed', { session, balance: result.balance });

      await tryWriteAudit(
        {
          action: 'fees.entry_reversed',
          actor: user.uid,
          actorRole: user.role,
          target: `${session}/${phone}`,
          after: { entryId: result.entryId, balance: result.balance },
          context: { requestId: log.requestId, reverses: body.reversesEntryId },
        },
        log
      );

      return { ok: true, ...result };
    }

    if (!body.amount) throw badRequest('An amount is required.');
    if (type === 'payment' && !body.method) {
      throw badRequest('How was this paid? Choose cash, M-Pesa or bank.');
    }

    const studentSnap = await db.doc(`sessions/${session}/students/${phone}`).get();
    if (!studentSnap.exists) throw notFound('That student no longer exists.');

    const result = await postEntry({
      phone,
      session,
      type,
      amount: body.amount,
      method: body.method ?? null,
      reference: body.reference ?? null,
      note: body.note ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : null,
      recordedBy: user.uid,
    });

    // ---- The partial-payment rule (D5).
    //
    // A partial payment does NOT clear a block. The block lifts only when the
    // balance reaches zero — or when the teacher unblocks by agreement, which
    // stays a separate, explicit action.
    let unblocked = false;
    const wasBlocked = studentSnap.data().blocked === true;

    if (
      body.autoUnblock !== false
      && wasBlocked
      && type === 'payment'
      && shouldAutoUnblock(result.balance)
    ) {
      await db.doc(`sessions/${session}/students/${phone}`).set(
        {
          blocked: false,
          blockReason: '',
          blockedAt: null,
          unblockedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      unblocked = true;
      log.info('Student auto-unblocked on full payment', { session });
    }

    log.info('Ledger entry posted', {
      session,
      type,
      balance: result.balance,
      duplicate: result.duplicate,
    });

    await tryWriteAudit(
      {
        action: `fees.${type}_posted`,
        actor: user.uid,
        actorRole: user.role,
        target: `${session}/${phone}`,
        before: { balance: result.previousBalance },
        after: { balance: result.balance, entryId: result.entryId },
        context: { requestId: log.requestId, method: body.method ?? null, unblocked },
      },
      log
    );

    return {
      ok: true,
      entryId: result.entryId,
      balance: result.balance,
      duplicate: result.duplicate,
      unblocked,
      // Surfaced so the UI can state the outcome precisely rather than assuming
      // a payment settled the account.
      stillOwes: result.balance > 0,
    };
  },
});
