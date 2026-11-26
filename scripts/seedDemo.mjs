#!/usr/bin/env node
/**
 * Seeds a SEPARATE demo copy of the app with sample data — 013Fixes / 35.
 * Walkthrough: docs/DEMO_DEPLOYMENT.md.
 *
 *   FIREBASE_SERVICE_ACCOUNT='<the demo project's JSON>' \
 *   DEMO_TEACHER_EMAIL=… DEMO_TEACHER_PASSWORD=… \
 *   DEMO_SUPERADMIN_EMAIL=… DEMO_SUPERADMIN_PASSWORD=… \
 *     node scripts/seedDemo.mjs
 *
 * SAFETY: refuses unless the Firebase project's id contains "demo" (or the
 * local emulator is in use), and never the production project. It never loads
 * .env.local, so a production credential can't be picked up by accident.
 *
 * Sample data only: every student is "<first name> Demo" with a number from
 * the unassigned +254 700 00x xxx block; no real names or numbers.
 */

import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const PRODUCTION_PROJECT = 'online-tutoring-6d71a';

/** Throws unless this is the emulator or a project whose id says "demo". */
export function assertDemoProject(projectId, { emulator = false } = {}) {
  if (emulator) return;
  if (!projectId || projectId === PRODUCTION_PROJECT || !/demo/i.test(projectId)) {
    throw new Error(`seedDemo refuses project "${projectId ?? 'unknown'}": only a project whose id contains "demo" (never production).`);
  }
}

const FIRST = ['Amani', 'Baraka', 'Chiku', 'Daudi', 'Eshe', 'Faraji', 'Gathoni', 'Hodari', 'Imara', 'Jabari',
  'Kioko', 'Lulu', 'Makena', 'Neema', 'Oloo', 'Pendo', 'Rehema', 'Sefu', 'Tumaini', 'Zawadi'];
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Kiswahili'];

export const demoPhone = (i) => `+2547000${String(10000 + i).padStart(5, '0')}`;

export function demoStudents(count = 40) {
  const sessions = ['morning', 'evening'];
  return Array.from({ length: count }, (_, i) => ({
    session: sessions[i % 2],
    phone: demoPhone(i),
    data: {
      studentName: `${FIRST[i % FIRST.length]} Demo`,
      parentPhone: demoPhone(i),
      class: `Form ${1 + (i % 4)}`,
      subjects: `${SUBJECTS[i % SUBJECTS.length]}, ${SUBJECTS[(i + 2) % SUBJECTS.length]}`,
      receiptMessage: `DEMO${String(i).padStart(6, '0')} Confirmed. Ksh3,000 sent (sample).`,
      registeredAt: new Date(Date.now() - i * 3_600_000),
      session: sessions[i % 2],
      blocked: i % 8 === 0,
      blockReason: i % 8 === 0 ? 'fees' : '',
      approvalStatus: i % 6 === 0 ? 'pending' : 'approved',
      receiptStatus: 'approved',
      feeBalance: i % 8 === 0 ? 1500 : 0,
    },
  }));
}

async function main() {
  const need = ['DEMO_TEACHER_EMAIL', 'DEMO_TEACHER_PASSWORD', 'DEMO_SUPERADMIN_EMAIL', 'DEMO_SUPERADMIN_PASSWORD'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Set ${missing.join(', ')} first (see docs/DEMO_DEPLOYMENT.md).`);

  const { getDb, getAdminApp } = await import('../api/_lib/firebaseAdmin.js');
  const app = getAdminApp();
  assertDemoProject(app.projectId, { emulator: app.emulated === true });
  const db = getDb();
  const authRest = await import('../api/_lib/authRest.js');

  const now = new Date();
  for (const [order, slug, name] of [[0, 'morning', 'Morning Session'], [1, 'evening', 'Evening Session']]) {
    await db.doc(`sessions/${slug}`).set({
      name, slug, icon: 'bi-book-fill', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      order, active: true, schedule: null, classes: ['Form 1', 'Form 2', 'Form 3', 'Form 4'], createdAt: now, updatedAt: now,
    });
  }
  for (const s of demoStudents()) {
    await db.doc(`sessions/${s.session}/students/${s.phone}`).set(s.data);
    if (s.data.feeBalance > 0) {
      await db.doc(`fees/accounts/items/${s.session}__${s.phone}`).set({ key: `${s.session}__${s.phone}`, phone: s.phone, session: s.session, balance: s.data.feeBalance, updatedAt: now });
    }
  }

  const user = async (email, password, claims, role) => {
    let uid;
    try {
      uid = (await authRest.createUser({ email, password, emailVerified: true })).uid;
    } catch {
      uid = (await authRest.getUserByEmail(email)).uid;
    }
    await authRest.setCustomUserClaims(uid, claims);
    await db.doc(`users/${uid}`).set({ role, email, createdAt: now }, { merge: true });
    return uid;
  };
  const teacherUid = await user(process.env.DEMO_TEACHER_EMAIL, process.env.DEMO_TEACHER_PASSWORD, { role: 'teacher' }, 'teacher');
  await user(process.env.DEMO_SUPERADMIN_EMAIL, process.env.DEMO_SUPERADMIN_PASSWORD, { role: 'superadmin' }, 'superadmin');

  await db.doc('subscription/current').set({
    tier: 'gold', status: 'active', grantedBySuperadmin: true, renewalMode: 'manual', ownerUid: teacherUid,
    currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 365 * 86_400_000),
  });
  await db.doc('config/flags').set({ 'fees.enabled': true, 'billing.enabled': true, 'sms.enabled': true, 'payments.daraja': true }, { merge: true });
  await db.doc('config/smsSetup').set({ schoolName: 'Demo Academy', unlockedAt: now }, { merge: true });
  // The demo preset, on: payments test, SMS fake, the DEMO ribbon.
  await db.doc('config/mode').set({ payments: 'test', sms: 'fake', demo: { on: true, previous: { payments: null, sms: null }, since: now } }, { merge: true });
  // M-Pesa "Pay now" on Demo (sandbox; never touches fees) — safe here, there are no real students.
  await db.doc('config/mpesaStatus').set({ mode: 'demo' }, { merge: true });

  console.log(`Seeded the demo copy (${app.projectId}): 2 sessions, ${demoStudents().length} sample students, a teacher and a superadmin login, Gold, demo mode on.`);
}

const invokedDirectly = Boolean(process.argv[1]) && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
