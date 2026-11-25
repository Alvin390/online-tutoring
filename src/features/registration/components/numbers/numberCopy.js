/**
 * Every word of the admission-number steps — 014Fixes (owner, 2026-11-24).
 * The approved wording is issues/014Fixes/plan/copy.md; change it there and
 * here together. `{session}` is the session's own name ("Morning Session",
 * "Evening"): never followed by "class", which would read "Morning Session class".
 *
 * The first screen's one-device note lives in CheckinCard (every student
 * loads it); everything here is in the lazy admission-number chunk.
 */

export const NUMBER_STEP = Object.freeze({
  title: 'Type your admission number',
  forSession: (session) => `for ${session}`,
  change: 'Change',
  label: 'Admission number',
  placeholder: 'e.g. 4071 (staff: S-4071)',
  button: 'Check in',
  checking: 'Checking…',
  forgotLink: 'Forgot your admission number?',
  forgotTitle: 'You already have an admission number',
  forgotBody: (session) => `You have an admission number for ${session}. Ask your teacher for it, then come back and check in.`,
  ok: 'OK',
  // The server's own words for these (api/student/checkin.js), kept in step.
  mismatch: "That admission number and phone don't match. Check both, or ask your teacher.",
  shape: 'Enter your 4-digit admission number (staff: S- and 4 digits).',
});

/** "Confirm your phone" and "Enter the code" (copy.md §2b). `{phone}` is masked. */
export const CONFIRM_STEP = Object.freeze({
  title: 'Confirm your phone',
  why: (phone) => `We'll send a 6-digit code by SMS to **${phone}**. Make sure that phone is near you so you can see the code.`,
  send: 'Send code',
  sending: 'Sending…',
  notNear: "That phone isn't near me. Use a different number.",
  codeTitle: 'Enter the code',
  codeWhy: (phone) => `We sent a 6-digit code to **${phone}**.`,
  noSms: "We couldn't send an SMS right now. **Ask your teacher for your code.**",
  codeLabel: 'Code',
  confirm: 'Confirm',
  checking: 'Checking…',
  resend: 'Send again',
  resendIn: (s) => `Send again in ${s} s`,
  resendLater: 'Send again later',
  didntGet: "Didn't get it?",
  help: 'Tap Send again when the countdown ends. Still nothing? Your teacher can see your code. Ask your teacher.',
  sixDigits: 'Enter the 6-digit code.',
  invalid: 'That code is not valid or has expired.',
  back: 'Back',
});

/** The number pop-up (copy.md §3). */
export const NUMBER_POPUP = Object.freeze({
  title: (kind) => (kind === 'staff' ? 'Your staff number' : 'Your admission number'),
  forSession: (kind, session) => `This is your ${kind === 'staff' ? 'staff' : 'admission'} number for **${session}**.`,
  copy: 'Copy number',
  copied: 'Copied', // the button's icon is the tick
  copyFallback: 'Select the number above and copy it, or write it down.',
  remember: "**Don't forget it.** Every time you check in, you'll enter your phone number, then this number. We've also sent it to you by SMS.",
  goToClass: "I've saved it. Go to class",
  saved: "I've saved it",
});

/** "Use a different number" (copy.md §2b). Phones are masked. */
export const DIFFERENT_NUMBER = Object.freeze({
  title: 'Use a different number',
  why: "Enter the phone number you'll use from now on.",
  send: 'Send code',
  sending: 'Sending…',
  confirmTitle: 'This will be your new number',
  confirmBody: (next, old, session) => `From now on, **${next}** will be your number for checking in to ${session}, and for messages from your teacher. **${old}** will stop working.`,
  yes: 'Yes, use this number',
  goBack: 'Go back',
  same: 'That is the number you started with. Enter the phone you have with you now.',
  back: 'Back',
  finishing: 'Moving your registration to the new number…',
});

/** Registering with a different phone (copy.md §5): nothing to move yet. */
export const REGISTER_PHONE = Object.freeze({
  confirmBody: (next, session) => `From now on, **${next}** will be your number for checking in to ${session}, and for messages from your teacher.`,
});

/** "We couldn't find this number" (copy.md §6; 012Fixes N1, option 2 reworded). */
export const NOT_REGISTERED = Object.freeze({
  title: "We couldn't find this number",
  why: (phone) => `${phone} isn't registered in this class.`,
  todoTitle: 'What to do now (choose one):',
  todo: [
    '**New student?** Tap **Register** to join this class.',
    '**Registered with a different number?** Tap **Back** and enter that number. When we offer to send the code, tap "That phone isn\'t near me" to switch to this number.',
    '**Typed it wrong?** Tap **Back** and fix the number.',
  ],
  ask: "If you don't remember which number you registered with, ask your teacher.",
  register: 'Register',
  back: 'Back',
});
