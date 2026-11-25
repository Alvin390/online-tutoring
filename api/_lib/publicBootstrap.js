import { getDb } from './firebaseAdmin.js';
import { getFlags } from './flags.js';
import { paystackMode, smsMode } from './mode.js';
import { maintenanceState } from './runtimeModes.js';
import { mpesaAvailability } from './mpesaAvailability.js';
import { sessionClasses } from './sessions.js';
import { resolveSubjectsByClass } from './subjects.js';

/**
 * Public bootstrap data and its per-isolate cache — Phase 13 / 08 A1.
 * Served by api/public/bootstrap.js; cleared by invalidateSession() on every
 * session write.
 *
 * `payments.mpesa` says whether the student screen may offer "Pay now"
 * (mpesaAvailability: flag + Gold plan + credentials). Only the yes/no
 * leaves the server — not the plan, not why.
 */

const TTL_MS = 60_000;
const PUBLIC_SESSION_FIELDS = ['name', 'description', 'schedule', 'icon', 'gradient', 'order'];

let cached = null;
let cachedAt = 0;

export function invalidateBootstrap() {
  cached = null;
  cachedAt = 0;
}

async function load() {
  const db = getDb();
  const [flags, snap, mpesa] = await Promise.all([
    getFlags(),
    db.collection('sessions').where('active', '==', true).get(),
    mpesaAvailability(db),
  ]);
  const sessions = snap.docs
    .map((d) => {
      const data = d.data();
      const out = { slug: d.id };
      for (const key of PUBLIC_SESSION_FIELDS) if (data[key] !== undefined) out[key] = data[key];
      // The registration form's class dropdown (the defaults if the teacher
      // has not set a list for this session).
      out.classes = sessionClasses(data);
      // Phase 14: each class's subjects, resolved (defaults by class name).
      out.subjectsByClass = resolveSubjectsByClass(data, out.classes);
      return out;
    })
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  // 013Fixes / 30b: `demo` — the screen says a demo payment doesn't pay fees.
  // 013Fixes / 33-35: the mode switches the screens show (banners).
  return { flags, sessions, payments: { mpesa: mpesa.available, demo: mpesa.available && mpesa.demo === true }, modes: publicModes() };
}

/**
 * 013Fixes / 33: what the screens need about the mode switches — only yes/no
 * (and, from 34, the maintenance message). Read from the cached config/mode.
 */
function publicModes() {
  const m = maintenanceState();
  return {
    paymentsTest: paystackMode() !== 'live',
    smsFake: smsMode() === 'fake',
    // 013Fixes / 34: the screens show "Under maintenance" without asking.
    maintenance: m.on ? { message: m.message, until: m.until } : null,
  };
}

/** The cached payload, reloading it when older than TTL_MS. */
export async function getPublicBootstrap() {
  if (!cached || Date.now() - cachedAt > TTL_MS) {
    cached = await load();
    cachedAt = Date.now();
  }
  return cached;
}
