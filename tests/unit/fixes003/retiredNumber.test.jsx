import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup } from '@testing-library/react';
import { renderSessionPage, unmockSessionPage } from '../fixes002/sessionPageHarness';
import { retiredMessage } from '@utils/duplicates';

/**
 * 003Fixes / 12 — a number the teacher declined or merged is told exactly
 * what to do at check-in, instead of being offered the registration form.
 */

beforeEach(() => { vi.resetModules(); sessionStorage.clear(); });
afterEach(() => { cleanup(); unmockSessionPage(); });

describe('retiredMessage', () => {
  it('declined, and merged with the kept number\'s last 3 digits', () => {
    expect(retiredMessage('duplicate')).toBe('This number was registered twice. Please check in with the number you registered with first, or ask your teacher to change your number.');
    expect(retiredMessage('merged', '678')).toBe('This number was merged with your other registration. Please check in with your number ending …678.');
  });
});

describe('check-in with a retired number', () => {
  it('merged: the message with the suffix, no registration form; Use a different number goes back', async () => {
    await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null, retired: 'merged', keptSuffix: '678' }) },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    const card = await screen.findByTestId('retired-number');
    expect(card.textContent).toMatch(/merged with your other registration\. Please check in with your number ending …678\./);
    expect(screen.queryByTestId('register')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use a different number/ })); });
    expect(screen.queryByTestId('retired-number')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });

  it('declined: the registered-twice message', async () => {
    await renderSessionPage({
      api: { checkinStudent: vi.fn().mockResolvedValue({ exists: false, student: null, retired: 'duplicate' }) },
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check in' })); });
    expect((await screen.findByTestId('retired-number')).textContent).toMatch(/registered twice/);
  });
});
