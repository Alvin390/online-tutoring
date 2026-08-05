import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  collectionGroup,
  query,
  where,
} from 'firebase/firestore';
import {
  makeTestEnv,
  anon,
  legacyStaff,
  teacher,
  superadmin,
  student,
  bronzeTeacher,
  seed,
  validRegistration,
  PHONE_A,
  PHONE_B,
} from './helpers.js';

/**
 * Firestore rules suite — Phase 01 D2.
 *
 * Every case in the phase file's minimum-coverage list is here, plus the
 * regressions for the two defects that motivated the rewrite.
 *
 * Requires the Firestore emulator. Run with `npm run test:rules`.
 */

let env;

const studentPath = (phone = PHONE_A, session = 'morning') =>
  `sessions/${session}/students/${phone}`;

beforeAll(async () => {
  env = await makeTestEnv();
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// ===========================================================================
// 1. The headline defect: student PII was world-readable
// ===========================================================================

describe('student documents are not world-readable', () => {
  beforeEach(async () => {
    await seed(env, studentPath(), validRegistration());
  });

  it('denies an anonymous read of a single student document', async () => {
    await assertFails(getDoc(doc(anon(env), studentPath())));
  });

  it('denies an anonymous LIST of the students collection (roster enumeration)', async () => {
    await assertFails(getDocs(collection(anon(env), 'sessions/morning/students')));
  });

  it('denies a student listing the roster even with a valid own-phone claim', async () => {
    await assertFails(
      getDocs(collection(student(env, PHONE_A), 'sessions/morning/students'))
    );
  });

  it('allows a teacher to read a student document', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), studentPath())));
  });

  it('allows a teacher to list the roster', async () => {
    await assertSucceeds(getDocs(collection(teacher(env), 'sessions/morning/students')));
  });
});

// ===========================================================================
// 2. Object-level permissions (IDOR)
// ===========================================================================

describe('object-level permissions', () => {
  beforeEach(async () => {
    await seed(env, studentPath(PHONE_A), validRegistration(PHONE_A));
    await seed(env, studentPath(PHONE_B), validRegistration(PHONE_B));
  });

  it('allows a student to read their own document', async () => {
    await assertSucceeds(getDoc(doc(student(env, PHONE_A), studentPath(PHONE_A))));
  });

  it('denies a student reading another student document', async () => {
    await assertFails(getDoc(doc(student(env, PHONE_A), studentPath(PHONE_B))));
  });
});

// ===========================================================================
// 3. The second defect: a create with no approval state
// ===========================================================================

describe('registration create requires explicit initial state', () => {
  it('accepts a well-formed registration', async () => {
    await assertSucceeds(
      setDoc(doc(anon(env), studentPath()), validRegistration())
    );
  });

  it('denies a create with approvalStatus absent', async () => {
    const data = validRegistration();
    delete data.approvalStatus;
    await assertFails(setDoc(doc(anon(env), studentPath()), data));
  });

  it('denies a create with blocked absent — the undefined-is-falsy bypass', async () => {
    const data = validRegistration();
    delete data.blocked;
    await assertFails(setDoc(doc(anon(env), studentPath()), data));
  });

  it('denies a create that self-approves', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath()), {
        ...validRegistration(),
        approvalStatus: 'approved',
      })
    );
  });

  it('denies a create that starts unblocked-but-approved with a positive balance', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath()), { ...validRegistration(), feeBalance: -5000 })
    );
  });

  it('denies a create that pre-sets receiptStatus to approved', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath()), {
        ...validRegistration(),
        receiptStatus: 'approved',
      })
    );
  });

  it('denies a create where the document ID does not match parentPhone', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath(PHONE_A)), validRegistration(PHONE_B))
    );
  });

  it('denies a create smuggling an unexpected field (mass assignment)', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath()), {
        ...validRegistration(),
        studentUid: 'attacker-controlled',
      })
    );
  });

  it('denies a create whose session does not match the path', async () => {
    await assertFails(
      setDoc(doc(anon(env), studentPath(PHONE_A, 'morning')), validRegistration(PHONE_A, 'evening'))
    );
  });
});

// ===========================================================================
// 4. Privilege escalation on update
// ===========================================================================

describe('students cannot escalate their own state', () => {
  beforeEach(async () => {
    await seed(env, studentPath(), { ...validRegistration(), blocked: true });
  });

  it('denies a student unblocking themselves', async () => {
    await assertFails(
      updateDoc(doc(student(env, PHONE_A), studentPath()), { blocked: false })
    );
  });

  it('denies a student approving themselves', async () => {
    await assertFails(
      updateDoc(doc(student(env, PHONE_A), studentPath()), { approvalStatus: 'approved' })
    );
  });

  // The value must differ from what is stored. Firestore's diff() reports no
  // affected keys when a write sets a field to the value it already holds, so
  // asserting against `feeBalance: 0` on a document seeded with 0 would pass
  // for the wrong reason — it tests a no-op, not an escalation.
  it('denies a student writing feeBalance', async () => {
    await assertFails(
      updateDoc(doc(student(env, PHONE_A), studentPath()), { feeBalance: -50000 })
    );
  });

  it('denies a student approving their own receipt', async () => {
    await assertFails(
      updateDoc(doc(student(env, PHONE_A), studentPath()), { receiptStatus: 'approved' })
    );
  });

  it('denies an anonymous caller writing lastAccessed (was previously allowed)', async () => {
    await assertFails(
      updateDoc(doc(anon(env), studentPath()), { lastAccessed: new Date() })
    );
  });

  it('allows a verified student to submit a pending receipt', async () => {
    await assertSucceeds(
      updateDoc(doc(student(env, PHONE_A), studentPath()), {
        pendingReceipt: 'QGH7UY23K1 Confirmed. Ksh1,500 sent.',
        receiptStatus: 'pending',
        receiptSubmittedAt: new Date(),
      })
    );
  });

  it('denies a student touching another student document', async () => {
    await assertFails(
      updateDoc(doc(student(env, PHONE_B), studentPath(PHONE_A)), { lastAccessed: new Date() })
    );
  });
});

describe('teachers cannot write server-owned fields', () => {
  beforeEach(async () => {
    await seed(env, studentPath(), validRegistration());
  });

  it('allows a teacher to block a student', async () => {
    await assertSucceeds(
      updateDoc(doc(teacher(env), studentPath()), {
        blocked: true,
        blockReason: 'Fees outstanding',
      })
    );
  });

  // As above: the value has to actually change for this to test anything.
  it('denies a teacher writing feeBalance directly', async () => {
    await assertFails(
      updateDoc(doc(teacher(env), studentPath()), { feeBalance: 25000 })
    );
  });

  it('denies a superadmin writing feeBalance directly', async () => {
    await assertFails(
      updateDoc(doc(superadmin(env), studentPath()), { feeBalance: 25000 })
    );
  });

  it('denies a teacher clearing an outstanding balance', async () => {
    await seed(env, studentPath(), { ...validRegistration(), feeBalance: 3000 });
    await assertFails(
      updateDoc(doc(teacher(env), studentPath()), { feeBalance: 0 })
    );
  });

  it('denies a teacher rewriting parentPhone', async () => {
    await assertFails(
      updateDoc(doc(teacher(env), studentPath()), { parentPhone: PHONE_B })
    );
  });

  it('allows a teacher to delete a student', async () => {
    await assertSucceeds(deleteDoc(doc(teacher(env), studentPath())));
  });

  it('denies an anonymous delete', async () => {
    await assertFails(deleteDoc(doc(anon(env), studentPath())));
  });
});

// ===========================================================================
// 5. Class links are no longer public
// ===========================================================================

describe('config/zoomLinks', () => {
  beforeEach(async () => {
    await seed(env, 'config/zoomLinks', {
      morning: 'https://us02web.zoom.us/j/123',
      evening: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('denies an anonymous read of the class link', async () => {
    await assertFails(getDoc(doc(anon(env), 'config/zoomLinks')));
  });

  it('denies a student reading the class link directly', async () => {
    await assertFails(getDoc(doc(student(env, PHONE_A), 'config/zoomLinks')));
  });

  it('allows a teacher to read and write it', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), 'config/zoomLinks')));
    await assertSucceeds(
      setDoc(doc(teacher(env), 'config/zoomLinks'), { morning: 'https://zoom.us/j/9' }, { merge: true })
    );
  });

  // Phase 04: rules are the third validation layer, behind the client's inline
  // check and /api/class/setLink. A teacher writing directly through the SDK
  // still cannot store an unsafe link.
  it('accepts a Google Meet link', async () => {
    await assertSucceeds(
      setDoc(
        doc(teacher(env), 'config/zoomLinks'),
        { evening: 'https://meet.google.com/abc-defg-hij' },
        { merge: true }
      )
    );
  });

  it('accepts a Zoom subdomain link', async () => {
    await assertSucceeds(
      setDoc(
        doc(teacher(env), 'config/zoomLinks'),
        { morning: 'https://us02web.zoom.us/j/123?pwd=x' },
        { merge: true }
      )
    );
  });

  const badLinks = [
    ['http rather than https', 'http://zoom.us/j/1'],
    ['a lookalike host', 'https://zoom.us.evil.com/j/1'],
    ['zoom.us only in the query string', 'https://evil.com/?x=zoom.us'],
    ['an arbitrary origin', 'https://evil.com/j/1'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a non-URL string', 'not-a-link'],
  ];

  for (const [label, url] of badLinks) {
    it(`denies writing ${label}`, async () => {
      await assertFails(
        setDoc(doc(teacher(env), 'config/zoomLinks'), { morning: url }, { merge: true })
      );
    });
  }

  it('denies a non-string link value', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'config/zoomLinks'), { morning: 12345 }, { merge: true })
    );
  });

  it('still allows writing only metadata fields', async () => {
    await assertSucceeds(
      setDoc(doc(teacher(env), 'config/zoomLinks'), { morningProvider: 'zoom' }, { merge: true })
    );
  });
});

describe('config/flags', () => {
  beforeEach(async () => {
    await seed(env, 'config/flags', { 'billing.enabled': false });
  });

  it('is readable by anyone — it holds booleans, no PII', async () => {
    await assertSucceeds(getDoc(doc(anon(env), 'config/flags')));
  });

  it('is writable only by the superadmin', async () => {
    await assertFails(setDoc(doc(teacher(env), 'config/flags'), { 'billing.enabled': true }));
    await assertSucceeds(
      setDoc(doc(superadmin(env), 'config/flags'), { 'billing.enabled': true })
    );
  });
});

// ===========================================================================
// 6. Server-only collections
// ===========================================================================

describe('server-only collections are closed to every client', () => {
  const cases = [
    ['subscription/current', 'subscription truth incl. Paystack authorization code'],
    ['integrations/daraja', 'M-Pesa credentials'],
    ['mpesa/transactions', 'STK push records'],
    ['billing/events', 'webhook log'],
    ['rateLimits/anything', 'rate limit counters'],
    ['otp/anything', 'OTP hashes'],
    ['loginAttempts/anything', 'brute-force counters'],
  ];

  for (const [path, label] of cases) {
    it(`denies a teacher reading ${label}`, async () => {
      await assertFails(getDoc(doc(teacher(env), path)));
    });

    it(`denies a teacher writing ${label}`, async () => {
      await assertFails(setDoc(doc(teacher(env), path), { tampered: true }));
    });
  }

  it('denies even the superadmin writing subscription/current', async () => {
    await assertFails(setDoc(doc(superadmin(env), 'subscription/current'), { tier: 'gold' }));
  });

  it('denies a teacher writing the audit trail', async () => {
    await assertFails(setDoc(doc(teacher(env), 'audit/forged'), { action: 'nope' }));
  });

  it('allows the superadmin to read the audit trail', async () => {
    await seed(env, 'audit/entry1', { action: 'student.blocked' });
    await assertSucceeds(getDoc(doc(superadmin(env), 'audit/entry1')));
  });

  it('denies a teacher reading the audit trail', async () => {
    await seed(env, 'audit/entry1', { action: 'student.blocked' });
    await assertFails(getDoc(doc(teacher(env), 'audit/entry1')));
  });

  it('allows a teacher to read the redacted subscription projection', async () => {
    await seed(env, 'subscription/public', { tier: 'silver', status: 'active' });
    await assertSucceeds(getDoc(doc(teacher(env), 'subscription/public')));
  });

  it('denies a teacher writing the subscription projection', async () => {
    await assertFails(setDoc(doc(teacher(env), 'subscription/public'), { tier: 'gold' }));
  });
});

// ===========================================================================
// 7. Tier-gated collections are closed until their phase opens them
// ===========================================================================

describe('unbuilt tier collections', () => {
  const paths = ['fees/config', 'calendar/events', 'whatsapp/campaigns', 'students/+254712345678'];

  for (const path of paths) {
    it(`denies a bronze teacher writing ${path}`, async () => {
      await assertFails(setDoc(doc(bronzeTeacher(env), path), { x: 1 }));
    });
  }
});

// ===========================================================================
// 8. Collection-group query support
// ===========================================================================

describe('collection-group reads', () => {
  beforeEach(async () => {
    await seed(env, studentPath(PHONE_A, 'morning'), validRegistration(PHONE_A, 'morning'));
    await seed(env, studentPath(PHONE_B, 'evening'), validRegistration(PHONE_B, 'evening'));
  });

  it('allows a teacher a collectionGroup query across sessions', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(teacher(env), 'students'),
          where('approvalStatus', '==', 'pending')
        )
      )
    );
  });

  it('denies an anonymous collectionGroup query', async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(anon(env), 'students'),
          where('approvalStatus', '==', 'pending')
        )
      )
    );
  });

  it('denies a student a collectionGroup query — no roster enumeration', async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(student(env, PHONE_A), 'students'),
          where('approvalStatus', '==', 'pending')
        )
      )
    );
  });
});

// ===========================================================================
// 9. Transitional role fallback — documented behaviour, asserted so that
//    removing the fallback later is a deliberate act with a failing test.
// ===========================================================================

describe('transitional isTeacher() fallback', () => {
  beforeEach(async () => {
    await seed(env, studentPath(), validRegistration());
  });

  it('treats a signed-in account with no role claim as the teacher', async () => {
    await assertSucceeds(getDoc(doc(legacyStaff(env), studentPath())));
  });

  it('does NOT treat a student-claimed account as staff', async () => {
    await assertFails(getDocs(collection(student(env, PHONE_B), 'sessions/morning/students')));
  });

  it('does not grant superadmin by fallback', async () => {
    await seed(env, 'audit/entry1', { action: 'x' });
    await assertFails(getDoc(doc(legacyStaff(env), 'audit/entry1')));
  });
});

// ===========================================================================
// 10. Private teacher notes — Phase 05 Part B
//
// The headline test of that phase. These notes say things like "weak in
// algebra" or "parent asked about bullying". A student reading their own notes
// is a trust breach, not a feature.
// ===========================================================================

describe('private student notes', () => {
  const notePath = (phone = PHONE_A, session = 'morning') =>
    `sessions/${session}/students/${phone}/notes/note1`;

  beforeEach(async () => {
    await seed(env, studentPath(PHONE_A), validRegistration(PHONE_A));
    await seed(env, notePath(), {
      body: 'Struggling with quadratics. Parent asked for extra practice.',
      tags: ['maths'],
      createdBy: 'teacher-uid',
    });
  });

  it('DENIES a student reading their OWN notes', async () => {
    // The one that matters most. A verified own-phone token is exactly the
    // case a naive rule would allow.
    await assertFails(getDoc(doc(student(env, PHONE_A), notePath())));
  });

  it('denies a student listing their own notes', async () => {
    await assertFails(
      getDocs(collection(student(env, PHONE_A), `sessions/morning/students/${PHONE_A}/notes`))
    );
  });

  it('denies another student reading them', async () => {
    await assertFails(getDoc(doc(student(env, PHONE_B), notePath())));
  });

  it('denies an anonymous read', async () => {
    await assertFails(getDoc(doc(anon(env), notePath())));
  });

  it('denies a student writing a note', async () => {
    await assertFails(
      setDoc(doc(student(env, PHONE_A), notePath(PHONE_A)), { body: 'injected' })
    );
  });

  it('denies a student a collection-group query over notes', async () => {
    await assertFails(getDocs(query(collectionGroup(student(env, PHONE_A), 'notes'))));
  });

  it('allows the teacher to read, write and delete', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), notePath())));
    await assertSucceeds(
      setDoc(doc(teacher(env), `sessions/morning/students/${PHONE_A}/notes/note2`), {
        body: 'Improving steadily.',
        tags: [],
        createdBy: 'teacher-uid',
      })
    );
    await assertSucceeds(deleteDoc(doc(teacher(env), notePath())));
  });

  it('keeps the parent student document readable by that student', async () => {
    // Notes are denied without denying the student their own record — which is
    // exactly why they are a subcollection rather than a field.
    await assertSucceeds(getDoc(doc(student(env, PHONE_A), studentPath(PHONE_A))));
  });
});

// ===========================================================================
// 11. Sessions — Phase 05 Part A
// ===========================================================================

describe('session documents', () => {
  const validSession = (slug = 'saturday') => ({
    name: 'Saturday Revision',
    slug,
    icon: 'bi-book-fill',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    order: 2,
    active: true,
  });

  it('is world-readable — an unauthenticated student must render the page', async () => {
    await seed(env, 'sessions/morning', validSession('morning'));
    await assertSucceeds(getDoc(doc(anon(env), 'sessions/morning')));
  });

  it('allows a teacher to create one', async () => {
    await assertSucceeds(
      setDoc(doc(teacher(env), 'sessions/saturday'), validSession('saturday'))
    );
  });

  it('denies an anonymous create', async () => {
    await assertFails(
      setDoc(doc(anon(env), 'sessions/saturday'), validSession('saturday'))
    );
  });

  it('denies a slug that does not match the document ID', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/saturday'), validSession('sunday'))
    );
  });

  it('denies reserved slugs', async () => {
    for (const slug of ['dashboard', 'login', 'billing', 'api', 'superadmin']) {
      // eslint-disable-next-line no-await-in-loop
      await assertFails(setDoc(doc(teacher(env), `sessions/${slug}`), validSession(slug)));
    }
  });

  it('denies a malformed slug', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/Bad_Slug'), validSession('Bad_Slug'))
    );
  });

  it('denies an unexpected field (mass assignment)', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/saturday'), {
        ...validSession('saturday'),
        classLink: 'https://zoom.us/j/1',
      })
    );
  });

  it('denies a non-boolean active flag', async () => {
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/saturday'), { ...validSession('saturday'), active: 'yes' })
    );
  });
});

describe('session class link stays private', () => {
  beforeEach(async () => {
    await seed(env, 'sessions/morning/private/classLink', {
      url: 'https://us02web.zoom.us/j/123',
      provider: 'zoom',
    });
  });

  it('DENIES an anonymous read — this is the Phase 01 leak, not reintroduced', async () => {
    await assertFails(getDoc(doc(anon(env), 'sessions/morning/private/classLink')));
  });

  it('denies a verified student reading it', async () => {
    await assertFails(getDoc(doc(student(env, PHONE_A), 'sessions/morning/private/classLink')));
  });

  it('allows the teacher to read it', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), 'sessions/morning/private/classLink')));
  });

  it('validates the link on write', async () => {
    await assertSucceeds(
      setDoc(doc(teacher(env), 'sessions/morning/private/classLink'), {
        url: 'https://meet.google.com/abc-defg-hij',
        provider: 'meet',
      })
    );
    await assertFails(
      setDoc(doc(teacher(env), 'sessions/morning/private/classLink'), {
        url: 'https://evil.com/?x=zoom.us',
        provider: 'zoom',
      })
    );
  });
});

// ===========================================================================
// 12. Fees — Phase 06
//
// Every write is server-only. The ledger is append-only and the balance is
// computed inside a transaction alongside it; a client that could write either
// could produce a balance that disagrees with the entries that created it.
// ===========================================================================

describe('fee ledger is append-only and server-written', () => {
  const ledgerPath = `fees/accounts/items/${PHONE_A}/ledger/entry1`;

  beforeEach(async () => {
    await seed(env, 'fees/config', { billingDayOfMonth: 1, autoBlockOnOverdue: false });
    await seed(env, `fees/accounts/items/${PHONE_A}`, { phone: PHONE_A, balance: 3000 });
    await seed(env, ledgerPath, {
      type: 'invoice',
      amount: 3000,
      balanceAfter: 3000,
      recordedBy: 'system',
    });
  });

  it('lets a teacher READ the ledger', async () => {
    await assertSucceeds(getDoc(doc(teacher(env), ledgerPath)));
  });

  it('DENIES a teacher creating a ledger entry', async () => {
    await assertFails(
      setDoc(doc(teacher(env), `fees/accounts/items/${PHONE_A}/ledger/forged`), {
        type: 'payment',
        amount: -3000,
      })
    );
  });

  it('DENIES a teacher updating an existing entry', async () => {
    await assertFails(updateDoc(doc(teacher(env), ledgerPath), { amount: 1 }));
  });

  it('DENIES a teacher deleting an entry', async () => {
    await assertFails(deleteDoc(doc(teacher(env), ledgerPath)));
  });

  it('DENIES the superadmin editing or deleting an entry', async () => {
    // "The owner can fix it in the console" is exactly how an audit trail
    // stops being one.
    await assertFails(updateDoc(doc(superadmin(env), ledgerPath), { amount: 1 }));
    await assertFails(deleteDoc(doc(superadmin(env), ledgerPath)));
  });

  it('DENIES a teacher writing the balance directly', async () => {
    await assertFails(
      updateDoc(doc(teacher(env), `fees/accounts/items/${PHONE_A}`), { balance: 0 })
    );
  });

  it('denies a student reading the ledger', async () => {
    // A student who could list their ledger could infer the whole pricing
    // structure. They get four numbers from /api/fees/summary instead.
    await assertFails(getDoc(doc(student(env, PHONE_A), ledgerPath)));
    await assertFails(
      getDocs(collection(student(env, PHONE_A), `fees/accounts/items/${PHONE_A}/ledger`))
    );
  });

  it('denies a student reading their own fee account document', async () => {
    await assertFails(getDoc(doc(student(env, PHONE_A), `fees/accounts/items/${PHONE_A}`)));
  });

  it('denies an anonymous read of anything under fees/', async () => {
    await assertFails(getDoc(doc(anon(env), 'fees/config')));
    await assertFails(getDoc(doc(anon(env), `fees/accounts/items/${PHONE_A}`)));
    await assertFails(getDoc(doc(anon(env), ledgerPath)));
  });

  it('denies a teacher writing fee config directly', async () => {
    await assertFails(setDoc(doc(teacher(env), 'fees/config'), { autoBlockOnOverdue: true }));
  });

  it('denies everyone touching the invoice-number counter', async () => {
    // A client that could write this could mint duplicate invoice numbers.
    await assertFails(getDoc(doc(teacher(env), 'fees/counters/items/invoice-2026')));
    await assertFails(setDoc(doc(teacher(env), 'fees/counters/items/invoice-2026'), { value: 1 }));
    await assertFails(setDoc(doc(superadmin(env), 'fees/counters/items/invoice-2026'), { value: 1 }));
  });

  it('lets a teacher read invoices but not write them', async () => {
    await seed(env, 'fees/invoices/items/2026-03_x', { number: 'INV-2026-0001', amount: 3000 });
    await assertSucceeds(getDoc(doc(teacher(env), 'fees/invoices/items/2026-03_x')));
    await assertFails(
      updateDoc(doc(teacher(env), 'fees/invoices/items/2026-03_x'), { amount: 0 })
    );
  });
});

// ===========================================================================
// 13. Default deny
// ===========================================================================

describe('deny by default', () => {
  it('denies reads of a collection nobody declared', async () => {
    await assertFails(getDoc(doc(teacher(env), 'somethingNobodyPlanned/doc1')));
  });

  it('denies writes to a collection nobody declared', async () => {
    await assertFails(setDoc(doc(teacher(env), 'somethingNobodyPlanned/doc1'), { x: 1 }));
  });
});
