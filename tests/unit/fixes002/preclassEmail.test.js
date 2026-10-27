import { describe, it, expect } from 'vitest';
import { nextClassWindow as clientWindow } from '@utils/classTime';
import { nextClassWindow as serverWindow } from '../../../api/_lib/classTime.js';
import {
  dueReminder, clockLabel, buildPreclassEmail, NO_REPLY_NOTICE,
} from '../../../api/_lib/preclassReminder.js';

/**
 * 002Fixes / 09 — the pre-class reminder: when it is due, what it says (counts
 * and a link, never names or numbers), and the owner's requirement that it
 * says plainly it is automated and not to be replied to.
 */

const eat = (iso) => Date.parse(`${iso}+03:00`);

describe('the server and the dashboard agree on class times', () => {
  const schedules = [
    { days: [], tz: 'Africa/Nairobi', startTime: '19:30', endTime: '21:30' },
    { days: [], tz: 'Africa/Nairobi', startTime: '08:30', endTime: '10:30' },
    { days: [1, 3, 5], tz: 'Africa/Nairobi', startTime: '16:00', endTime: '18:00' },
    { days: [], tz: 'Africa/Nairobi', startTime: '23:30', endTime: '01:00' },
    { startTime: '19:30' },
    { startTime: 'bad' },
  ];
  const moments = ['2026-10-27T07:00', '2026-10-27T18:40', '2026-10-27T20:00', '2026-10-27T23:59', '2026-10-28T00:30', '2026-11-01T12:00'];
  it('same answers for every schedule at every moment', () => {
    for (const s of schedules) for (const m of moments) expect(serverWindow(s, eat(m))).toEqual(clientWindow(s, eat(m)));
  });
});

describe('dueReminder', () => {
  const start = eat('2026-10-27T19:30');
  it('60 from an hour before, 15 from a quarter before, nothing once class has started', () => {
    expect(dueReminder(start, eat('2026-10-27T18:29'))).toBeNull();
    expect(dueReminder(start, eat('2026-10-27T18:30'))).toBe('60');
    expect(dueReminder(start, eat('2026-10-27T19:14'))).toBe('60');
    expect(dueReminder(start, eat('2026-10-27T19:15'))).toBe('15');
    expect(dueReminder(start, eat('2026-10-27T19:29'))).toBe('15');
    expect(dueReminder(start, eat('2026-10-27T19:30'))).toBeNull();
  });

  it('a sweep every ten minutes always lands in each window', () => {
    for (let offset = 0; offset < 10; offset += 1) {
      const seen = new Set();
      for (let t = eat('2026-10-27T17:00') + offset * 60_000; t < start; t += 10 * 60_000) seen.add(dueReminder(start, t));
      expect(seen.has('60') && seen.has('15')).toBe(true);
    }
  });
});

describe('the email', () => {
  const email = buildPreclassEmail({
    sessionName: 'Evening Session', startLabel: clockLabel('19:30'), minutesLeft: 50,
    counts: [['Form 3', 2], ['Grade 8', 1]], dashboardUrl: 'https://tutor.example/dashboard',
  });

  it('subject: the count, the class and its time', () => {
    expect(email.subject).toBe('3 students waiting for approval — Evening Session at 7:30 PM');
  });

  it('body: counts per class and the dashboard link', () => {
    expect(email.text).toMatch(/3 students are waiting for your approval for Evening Session, which starts at 7:30 PM \(in about 50 minutes\)\./);
    expect(email.text).toMatch(/ {2}Form 3: 2\n {2}Grade 8: 1/);
    expect(email.text).toContain('https://tutor.example/dashboard');
    expect(email.html).toContain('href="https://tutor.example/dashboard"');
  });

  it('says it is automated and not to be replied to — first thing, and again at the end, in both parts', () => {
    expect(NO_REPLY_NOTICE).toBe('This is an automated email from Online Tutoring. Please do not reply to it — replies are not read.');
    expect(email.text.startsWith(NO_REPLY_NOTICE)).toBe(true);
    expect(email.text.split(NO_REPLY_NOTICE)).toHaveLength(3);
    expect(email.html.indexOf('This is an automated email')).toBeLessThan(email.html.indexOf('waiting for your approval'));
    expect(email.html.split('This is an automated email')).toHaveLength(3);
  });

  it('one student reads naturally', () => {
    const one = buildPreclassEmail({ sessionName: 'Morning Session', startLabel: '8:30 AM', minutesLeft: 12, counts: [['Form 3', 1]], dashboardUrl: 'x' });
    expect(one.subject).toBe('1 student waiting for approval — Morning Session at 8:30 AM');
    expect(one.text).toMatch(/1 student is waiting/);
  });

  it('escapes class names in HTML', () => {
    const odd = buildPreclassEmail({ sessionName: 'S', startLabel: '1:00 PM', counts: [['<b>Form</b>', 1]], dashboardUrl: 'x' });
    expect(odd.html).toContain('&lt;b&gt;Form&lt;/b&gt;');
  });

  it('a test reminder is marked as a test and still carries the notice', () => {
    const test = buildPreclassEmail({ sessionName: 'Evening Session', startLabel: '7:30 PM', counts: [['Form 3', 2]], dashboardUrl: 'x', test: true });
    expect(test.subject.startsWith('[Test] ')).toBe(true);
    expect(test.text).toMatch(/This is a TEST/);
    expect(test.text.startsWith(NO_REPLY_NOTICE)).toBe(true);
  });

  it('clockLabel matches the class page', () => {
    expect(clockLabel('19:30')).toBe('7:30 PM');
    expect(clockLabel('08:05')).toBe('8:05 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
    expect(clockLabel('00:15')).toBe('12:15 AM');
  });
});
