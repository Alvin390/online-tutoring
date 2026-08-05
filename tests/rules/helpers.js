import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');

export const PROJECT_ID = 'online-tutoring-rules-test';

export async function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(projectRoot, 'firestore.rules'), 'utf8'),
      // Must match firebase.json > emulators.firestore.port.
      host: '127.0.0.1',
      port: 8085,
    },
  });
}

// --- Context factories -----------------------------------------------------

export const anon = (env) => env.unauthenticatedContext().firestore();

/**
 * A signed-in account with NO role claim. This is the transitional case the
 * rules deliberately treat as the teacher — see the removal criterion on
 * isTeacher() in firestore.rules.
 */
export const legacyStaff = (env) => env.authenticatedContext('legacy-uid').firestore();

export const teacher = (env) =>
  env.authenticatedContext('teacher-uid', { role: 'teacher', tier: 'bronze', tierRank: 1 }).firestore();

export const superadmin = (env) =>
  env.authenticatedContext('super-uid', { role: 'superadmin' }).firestore();

export const student = (env, phone) =>
  env.authenticatedContext(`student-${phone}`, { role: 'student', phone }).firestore();

export const bronzeTeacher = (env) =>
  env.authenticatedContext('bronze-uid', { role: 'teacher', tier: 'bronze', tierRank: 1 }).firestore();

// --- Fixtures --------------------------------------------------------------

export const PHONE_A = '+254712345678';
export const PHONE_B = '+254798765432';

export function validRegistration(phone = PHONE_A, session = 'morning') {
  return {
    studentName: 'Amina Wanjiru',
    parentPhone: phone,
    class: 'Grade 8',
    subjects: 'Mathematics, Physics',
    receiptMessage: 'QGH7UY23K1 Confirmed. Ksh3,000 sent to Tutor.',
    registeredAt: new Date(),
    session,
    blocked: false,
    approvalStatus: 'pending',
    receiptStatus: 'pending',
    feeBalance: 0,
  };
}

/** Seeds a document bypassing rules, for read/update tests. */
export async function seed(env, path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc(path).set(data);
  });
}
