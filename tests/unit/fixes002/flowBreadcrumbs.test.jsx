import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage, PHONE } from './sessionPageHarness';

/**
 * 002Fixes / 01 — the check-in flow leaves breadcrumbs: every screen change and
 * every action, with the number's length and emptiness but never its digits.
 */

const pendingStudent = { studentName: 'Amina', approvalStatus: 'pending', blocked: false };

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

it('records screens and actions, and the number only as a shape', async () => {
  const monitoring = await import('@utils/monitoring');
  const addBreadcrumb = vi.fn();
  monitoring.__setSentryForTest({ addBreadcrumb });

  await renderSessionPage({ api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: pendingStudent }) } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Check again' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use a different number' })); });

  const crumbs = addBreadcrumb.mock.calls.map(([c]) => c);
  expect(crumbs.every((c) => c.category === 'checkin.flow')).toBe(true);
  expect(crumbs.map((c) => c.data)).toEqual(expect.arrayContaining([
    { screen: 'checkin' },
    { action: 'checkin', numberLength: PHONE.length, numberEmpty: false },
    { screen: 'pending' },
    { action: 'refresh', numberLength: PHONE.length, numberEmpty: false },
    { action: 'back' },
  ]));
  expect(JSON.stringify(crumbs)).not.toContain(PHONE.slice(1));
  monitoring.__setSentryForTest(null);
});
