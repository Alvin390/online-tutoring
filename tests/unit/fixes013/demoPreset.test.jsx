import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import DemoRibbon from '@shared/components/DemoRibbon';
import { modesStore } from '@/shared/config/modesStore';

/**
 * 013Fixes / 35 — the demo preset: a DEMO ribbon for teachers and students
 * while it is on; one click on the Modes card turns it on and off (with TEST
 * typed in a paid period on live payments).
 */

const api = vi.hoisted(() => ({}));
vi.mock('@services/api/adminModes', () => ({
  getModes: (...a) => api.getModes(...a),
  setPaymentsMode: vi.fn(),
  setSmsMode: vi.fn(),
  setMaintenance: vi.fn(),
  setDemo: (...a) => api.setDemo(...a),
}));

const view = (demoOn, over = {}) => ({
  payments: { mode: demoOn ? 'test' : 'live', source: 'setting', liveKeys: true },
  sms: { mode: demoOn ? 'fake' : 'real', source: 'setting' },
  maintenance: { on: false, message: null, until: null },
  demo: { on: demoOn },
  paidPeriod: false,
  ...over,
});

beforeEach(() => { modesStore.__reset(); });
afterEach(() => cleanup());

describe('the DEMO ribbon', () => {
  it('only while the demo preset is on', () => {
    render(<DemoRibbon />);
    expect(screen.queryByTestId('demo-ribbon')).toBeNull();
    act(() => modesStore.setFromRemote({ demo: true }));
    expect(screen.getByTestId('demo-ribbon').textContent).toMatch(/DEMO: payments are test payments and SMS are not sent/);
  });
});

describe('the Modes card: demo preset', () => {
  it('on, then off; the page gets the ribbon at once', async () => {
    api.getModes = vi.fn().mockResolvedValue(view(false));
    api.setDemo = vi.fn(async (on) => view(on));
    const { default: ModesCard } = await import('@/features/admin/components/ModesCard');
    render(<ModesCard />);
    await act(async () => {});
    expect(screen.getByTestId('demo-badge').textContent).toBe('Off');
    expect(screen.getByTestId('demo-preset').textContent).toMatch(/Pay now.*is not changed/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn demo on' })); });
    expect(api.setDemo).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('demo-badge').textContent).toBe('On');
    expect(modesStore.get()).toMatchObject({ demo: true, paymentsTest: true, smsFake: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn demo off' })); });
    expect(api.setDemo).toHaveBeenLastCalledWith(false);
    expect(modesStore.get()).toMatchObject({ demo: false, paymentsTest: false, smsFake: false });
  });

  it('paid period on live payments: TEST typed first', async () => {
    api.getModes = vi.fn().mockResolvedValue(view(false, { paidPeriod: true }));
    api.setDemo = vi.fn(async (on, confirm) => {
      if (on && confirm !== 'TEST') throw Object.assign(new Error('The school is in a paid period. Type TEST to start the demo (payments go to test).'), { code: 'confirm_required' });
      return view(on);
    });
    const { default: ModesCard } = await import('@/features/admin/components/ModesCard');
    render(<ModesCard />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn demo on' })); });
    expect(screen.getByTestId('payments-confirm').textContent).toMatch(/start the demo/);
    fireEvent.change(screen.getByLabelText('Type TEST'), { target: { value: 'TEST' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to test' })); });
    expect(api.setDemo).toHaveBeenLastCalledWith(true, 'TEST');
    expect(screen.getByTestId('demo-badge').textContent).toBe('On');
  });
});
