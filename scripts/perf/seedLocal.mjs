#!/usr/bin/env node
/**
 * Realistic local data for performance measurement — Phase 13 / 01 D4.
 *
 *   firebase emulators:start --only firestore,auth --project demo-online-tutoring
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-online-tutoring npm run perf:seed
 *
 * EMULATOR ONLY. It refuses to start unless FIRESTORE_EMULATOR_HOST is set, and
 * it never loads .env.local, so a production credential cannot be picked up by
 * accident.
 *
 * Seeds: 3 sessions, 500 students (names include O'Brien and Mary-Jane on
 * purpose), 200 ledger entries, 50 notes, 30 calendar events, and a Gold teacher
 * account (teacher@perf.local / perf-pass-123).
 */

import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

export function assertEmulator(env = process.env) {
  if (!env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'seedLocal refuses to run without FIRESTORE_EMULATOR_HOST — it is for the local emulator only.'
    );
  }
}

const FIRST = ['Amina', 'Brian', 'Cynthia', 'David', 'Esther', 'Felix', 'Grace', 'Hassan', 'Imani', 'John',
  'Kevin', 'Lilian', 'Mary-Jane', 'Njeri', 'Otieno', 'Purity', 'Sean', 'Tabitha', 'Wanjiku', 'Zoë'];
const LAST = ['Wanjiru', 'Otieno', "O'Brien", 'Kamau', 'Mwangi', 'Achieng', 'Kiptoo', 'Njoroge', 'Odhiambo', 'Mutua'];
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Kiswahili'];

export async function seed({ students = 500 } = {}) {
  assertEmulator();
  process.env.GCLOUD_PROJECT ??= 'demo-online-tutoring';

  const { getDb } = await import('../../api/_lib/firebaseAdmin.js');
  const db = getDb();

  const sessions = [
    { slug: 'morning', name: 'Morning Session', order: 0 },
    { slug: 'evening', name: 'Evening Session', order: 1 },
    { slug: 'weekend', name: 'Weekend Revision', order: 2 },
  ];

  let batch = db.batch();
  let pending = 0;
  const flush = async (force = false) => {
    if (pending >= 400 || (force && pending > 0)) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };
  const put = async (path, data) => {
    batch.set(db.doc(path), data);
    pending += 1;
    await flush();
  };

  for (const s of sessions) {
    await put(`sessions/${s.slug}`, {
      name: s.name, slug: s.slug, icon: 'bi-book-fill',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      order: s.order, active: true, schedule: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await put(`sessions/${s.slug}/private/classLink`, {
      url: `https://zoom.us/j/${1000000000 + s.order}`, provider: 'zoom', updatedAt: new Date(),
    });
  }

  const phones = [];
  for (let i = 0; i < students; i += 1) {
    const session = sessions[i % sessions.length].slug;
    const phone = `+2547${String(10000000 + i).padStart(8, '0')}`;
    phones.push({ phone, session });
    await put(`sessions/${session}/students/${phone}`, {
      studentName: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      parentPhone: phone,
      class: `Grade ${4 + (i % 9)}`,
      subjects: `${SUBJECTS[i % SUBJECTS.length]}, ${SUBJECTS[(i + 2) % SUBJECTS.length]}`,
      receiptMessage: `QX${String(i).padStart(8, '0')} Confirmed. Ksh3,000 sent.`,
      registeredAt: new Date(Date.now() - i * 3_600_000),
      lastAccessed: new Date(Date.now() - i * 60_000),
      session,
      blocked: i % 25 === 0,
      blockReason: i % 25 === 0 ? 'Fees outstanding' : '',
      approvalStatus: i % 10 === 0 ? 'pending' : 'approved',
      receiptStatus: 'approved',
      feeBalance: i < 100 ? 1500 : 0,
    });
  }

  for (let i = 0; i < 200; i += 1) {
    const { phone, session } = phones[i % 100];
    await put(`fees/accounts/items/${phone}/ledger/seed_${i}`, {
      type: i % 2 ? 'payment' : 'invoice', amount: 1500, method: i % 2 ? 'mpesa' : null,
      reference: i % 2 ? `TJK${String(i).padStart(7, '0')}` : null,
      occurredAt: new Date(Date.now() - i * 86_400_000), recordedAt: new Date(),
      recordedBy: 'seed', session, phone,
    });
  }
  for (let i = 0; i < 100; i += 1) {
    const { phone, session } = phones[i];
    await put(`fees/accounts/items/${phone}`, { phone, session, balance: 1500, updatedAt: new Date() });
  }

  for (let i = 0; i < 50; i += 1) {
    const { phone, session } = phones[i];
    await put(`sessions/${session}/students/${phone}/notes/n${i}`, {
      body: `Seed note ${i}: progressing well in algebra.`, tags: ['seed'], createdAt: new Date(), deletedAt: null,
    });
  }

  for (let i = 0; i < 30; i += 1) {
    const start = new Date(Date.UTC(2026, 9, 1 + i, 5, 0));
    await put(`calendar/events/items/seed_${i}`, {
      title: `Class ${i}`, description: null, start, end: new Date(start.getTime() + 3_600_000),
      allDay: false, colour: '#667eea', sessionIds: [], recurrence: null, isRecurring: false,
      recurrenceExceptions: [], createdAt: new Date(), updatedAt: new Date(),
    });
  }

  await put('config/flags', {
    'auth.roles': true, 'notes.enabled': true, 'fees.enabled': true, 'calendar.enabled': true,
    'sessions.teacherDefined': true, 'whatsapp.broadcast': true, 'payments.daraja': true,
  });
  await flush(true);

  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    const authRest = await import('../../api/_lib/authRest.js');
    try {
      await authRest.createUser({ uid: 'perf-teacher', email: 'teacher@perf.local', password: 'perf-pass-123', emailVerified: true });
    } catch { /* already exists */ }
    await authRest.setCustomUserClaims('perf-teacher', { role: 'teacher', tier: 'gold', tierRank: 3, subActive: true });
  }

  return { sessions: sessions.length, students, ledger: 200, notes: 50, events: 30 };
}

// fileURLToPath, not string matching: the repo path contains spaces, which the
// module URL percent-encodes.
const invokedDirectly = Boolean(process.argv[1]) && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  seed()
    .then((summary) => console.log('Seeded:', JSON.stringify(summary)))
    .catch((err) => {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    });
}
