import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage } from './sessionPageHarness';

/**
 * 002Fixes / 08 — the class page tells new students to register before class
 * day, only where the teacher approves new students, and only on the check-in
 * card.
 */

beforeEach(() => vi.resetModules());
afterEach(() => { cleanup(); unmockSessionPage(); });

const hint = () => screen.queryByTestId('register-early-hint');

it('shown on the check-in card when approval is on', async () => {
  await renderSessionPage({ requireApproval: true });
  expect(hint().textContent).toMatch(/New here\? Register before class day/);
});

it('hidden when the teacher does not approve new students', async () => {
  await renderSessionPage({ requireApproval: false });
  expect(hint()).toBeNull();
});

it('gone once the student has checked in', async () => {
  await renderSessionPage({
    api: { checkinStudent: vi.fn().mockResolvedValue({ exists: true, student: { studentName: 'Amina', approvalStatus: 'pending', blocked: false } }) },
  });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
  expect(screen.getByTestId('pending')).toBeTruthy();
  expect(hint()).toBeNull();
});
