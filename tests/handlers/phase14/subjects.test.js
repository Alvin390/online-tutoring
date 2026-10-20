import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  pinEnv, installFetchGuard, call, userWithClaims, teacherClaims, getTestDb, clearFirestore,
  setFlags, phoneN,
} from '../_worker.js';

/**
 * Phase 14 — subjects per class (server).
 *
 * The teacher edits each class's subjects per session (sessions/manage
 * `subjectsByClass`); a class with no entry offers its defaults by name; the
 * public bootstrap carries the resolved lists; registration and resubmission
 * accept only listed subjects and require the compulsory ones. Stored as the
 * same comma-separated text as before.
 */

let db;
let gold;

const JUNIOR = [
  'English', 'Kiswahili', 'Mathematics', 'Integrated Science', 'Social Studies', 'Religious Education',
  'Pre-Technical Studies', 'Agriculture and Nutrition', 'Creative Arts and Sports',
];

beforeAll(async () => {
  pinEnv();
  installFetchGuard();
  db = await getTestDb();
  gold = await userWithClaims('p14-subjects-gold', teacherClaims.gold);
});

beforeEach(async () => {
  await clearFirestore();
  (await import('../../../api/_lib/sessions.js')).__resetSessionCache();
  await setFlags(db, { 'auth.legacyStudentRead': true });
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  await call('/api/sessions/manage', { token: gold, body: { action: 'bootstrap' } });
});

const manage = (body) => call('/api/sessions/manage', { token: gold, body });
const bootstrap = async () => {
  (await import('../../../api/_lib/publicBootstrap.js')).invalidateBootstrap();
  return call('/api/public/bootstrap', { method: 'GET' });
};
const register = (cls, subjects, phone = phoneN(1), session = 'morning') => call('/api/student/register', {
  body: { session, phone, studentName: 'Amina Wanjiru', class: cls, subjects, receiptMessage: 'QAB123XYZ9 Confirmed' },
});
const stored = async (phone = phoneN(1), session = 'morning') =>
  (await db.doc(`sessions/${session}/students/${phone}`).get()).data();

describe('defaults', () => {
  it('the default classes are Grade 7, Grade 8, Grade 10 and Form 3, each with its default subjects', async () => {
    const res = await bootstrap();
    const morning = res.body.sessions.find((s) => s.slug === 'morning');
    expect(morning.classes).toEqual(['Grade 7', 'Grade 8', 'Grade 10', 'Form 3']);
    const names = (cls) => morning.subjectsByClass[cls].map((s) => s.name);
    expect(names('Grade 7')).toEqual(JUNIOR);
    expect(names('Grade 8')).toEqual(JUNIOR);
    expect(names('Grade 10')).toEqual(['English', 'Kiswahili', 'Mathematics', 'Community Service Learning (CSL)']);
    expect(morning.subjectsByClass['Form 3']).toEqual([
      { name: 'English', compulsory: true },
      { name: 'Kiswahili', compulsory: true },
      { name: 'Mathematics', compulsory: true },
    ]);
    expect(morning.subjectsByClass['Grade 10'].some((s) => s.compulsory)).toBe(false);
  });

  it("a live session's string class list (as saved today) gets the defaults by class name; an unknown class gets none", async () => {
    await db.doc('sessions/morning').set({ classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form 3', 'Adult Class'] }, { merge: true });
    const morning = (await bootstrap()).body.sessions.find((s) => s.slug === 'morning');
    expect(morning.subjectsByClass['Grade 8'].map((s) => s.name)).toEqual(JUNIOR);
    expect(morning.subjectsByClass['Adult Class']).toEqual([]);
  });
});

describe('the teacher edits subjects per class', () => {
  it('saves a class\'s subjects (tidied, compulsory kept), audits it, and the bootstrap serves it', async () => {
    const res = await manage({
      action: 'update', slug: 'morning',
      subjectsByClass: { 'Grade 10': [{ name: ' Physics ', compulsory: true }, { name: 'Chemistry' }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changed).toContain('subjectsByClass');
    expect((await db.doc('sessions/morning').get()).data().subjectsByClass).toEqual({
      'Grade 10': [{ name: 'Physics', compulsory: true }, { name: 'Chemistry', compulsory: false }],
    });
    const audits = await db.collection('audit').where('action', '==', 'session.updated').get();
    expect(audits.docs.some((d) => (d.data().after?.changed ?? []).includes('subjectsByClass'))).toBe(true);

    const morning = (await bootstrap()).body.sessions.find((s) => s.slug === 'morning');
    expect(morning.subjectsByClass['Grade 10'].map((s) => s.name)).toEqual(['Physics', 'Chemistry']);
    // Classes without an entry still get their defaults.
    expect(morning.subjectsByClass['Form 3'].every((s) => s.compulsory)).toBe(true);
  });

  it('an empty list means the free-text box; entries for classes the session does not offer are dropped', async () => {
    await manage({ action: 'update', slug: 'morning', subjectsByClass: { 'Grade 7': [], 'Not A Class': [{ name: 'X' }] } });
    expect((await db.doc('sessions/morning').get()).data().subjectsByClass).toEqual({ 'Grade 7': [] });
    const morning = (await bootstrap()).body.sessions.find((s) => s.slug === 'morning');
    expect(morning.subjectsByClass['Grade 7']).toEqual([]);
  });

  it('renaming a class with its subjects in the same save keeps them under the new name', async () => {
    const res = await manage({
      action: 'update', slug: 'morning',
      classes: ['Grade 7', 'Grade 8', 'Grade 10', 'Form Three'],
      subjectsByClass: { 'Form Three': [{ name: 'English', compulsory: true }] },
    });
    expect(res.status).toBe(200);
    const doc = (await db.doc('sessions/morning').get()).data();
    expect(doc.subjectsByClass).toEqual({ 'Form Three': [{ name: 'English', compulsory: true }] });
  });

  for (const [label, list] of [
    ['a blank subject', [{ name: '  ' }]],
    ['a duplicate subject (case-insensitive)', [{ name: 'English' }, { name: 'english' }]],
    ['more than 30 subjects', Array.from({ length: 31 }, (_, i) => ({ name: `S${i}` }))],
    ['a 61-character subject', [{ name: 'x'.repeat(61) }]],
    ['an unknown field', [{ name: 'English', colour: 'red' }]],
  ]) {
    it(`refuses ${label}`, async () => {
      expect((await manage({ action: 'update', slug: 'morning', subjectsByClass: { 'Grade 7': list } })).status).toBe(400);
    });
  }

  it('a new session may be created with its subjects', async () => {
    const res = await manage({
      action: 'create', slug: 'saturday', name: 'Saturday Class', classes: ['Form 3'],
      subjectsByClass: { 'Form 3': [{ name: 'English', compulsory: true }, { name: 'Biology' }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.doc('sessions/saturday').get()).data().subjectsByClass['Form 3']).toHaveLength(2);
  });
});

describe('registration checks the subjects', () => {
  it('accepts checked subjects (an array), stored as text in the list\'s order and spelling', async () => {
    const res = await register('Grade 8', ['mathematics', 'English']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).subjects).toBe('English, Mathematics');
  });

  it('Form 3: the compulsory subjects are required', async () => {
    const missing = await register('Form 3', ['English', 'Mathematics']);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'invalid_subjects', message: 'Kiswahili is compulsory for Form 3.' });
    const ok = await register('Form 3', ['English', 'Kiswahili', 'Mathematics'], phoneN(2));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('refuses a subject that is not on the class\'s list, and an empty choice', async () => {
    const off = await register('Grade 10', ['English', 'Physics']);
    expect(off.status).toBe(400);
    expect(off.body.error.message).toBe('"Physics" is not a subject for Grade 10. Please choose from the list.');
    expect((await register('Grade 10', [])).status).toBe(400);
  });

  it('legacy comma text is accepted when it matches the list (an old cached page)', async () => {
    const res = await register('Grade 10', 'English, Kiswahili');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).subjects).toBe('English, Kiswahili');
  });

  it('a class without a subject list keeps free text', async () => {
    await db.doc('sessions/morning').set({ classes: ['Adult Class'] }, { merge: true });
    const res = await register('Adult Class', 'Bookkeeping and typing');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).subjects).toBe('Bookkeeping and typing');
  });

  it('all nine Grade 7 subjects fit (over the old 200-character limit is fine up to 500)', async () => {
    await manage({
      action: 'update', slug: 'morning',
      subjectsByClass: { 'Grade 7': Array.from({ length: 12 }, (_, i) => ({ name: `Long subject name number ${i + 1} xx` })) },
    });
    const all = Array.from({ length: 12 }, (_, i) => `Long subject name number ${i + 1} xx`);
    const res = await register('Grade 7', all);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored()).subjects.length).toBeGreaterThan(200);
  });
});

describe('resubmission checks the subjects the same way', () => {
  async function rejected(phone) {
    await db.doc(`sessions/morning/students/${phone}`).set({
      studentName: 'Amina Wanjiru', parentPhone: phone, class: 'Grade 8', subjects: 'English',
      receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date(), session: 'morning',
      blocked: false, approvalStatus: 'rejected', receiptStatus: 'pending', feeBalance: 0,
    });
  }
  const resubmit = (phone, cls, subjects) => call('/api/student/resubmit', {
    body: { session: 'morning', phone, studentName: 'Amina Wanjiru', class: cls, subjects, receiptMessage: 'QAB123XYZ9 Confirmed' },
  });

  it('accepts listed subjects and stores the text', async () => {
    await rejected(phoneN(30));
    const res = await resubmit(phoneN(30), 'Form 3', ['English', 'Kiswahili', 'Mathematics']);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored(phoneN(30))).subjects).toBe('English, Kiswahili, Mathematics');
  });

  it('refuses a missing compulsory subject', async () => {
    await rejected(phoneN(31));
    const res = await resubmit(phoneN(31), 'Form 3', ['English']);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Kiswahili and Mathematics are compulsory for Form 3.');
  });
});

describe('existing students are untouched', () => {
  it('a student registered with free text keeps it; the teacher may save up to 500 characters', async () => {
    const phone = phoneN(40);
    await db.doc(`sessions/morning/students/${phone}`).set({
      studentName: 'Existing', parentPhone: phone, class: 'Grade 10', subjects: 'Maths, Physics',
      receiptMessage: 'QAB123XYZ9 Confirmed', registeredAt: new Date(), session: 'morning',
      blocked: false, approvalStatus: 'approved', receiptStatus: 'approved', feeBalance: 0,
    });
    expect((await stored(phone)).subjects).toBe('Maths, Physics');
    const long = Array.from({ length: 12 }, (_, i) => `Subject number ${i + 1} long name`).join(', ');
    const res = await call('/api/student/update', {
      token: gold, body: { session: 'morning', phone, changes: { subjects: long } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await stored(phone)).subjects).toBe(long);
  });
});
