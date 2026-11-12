import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 007Fixes / 06 (Release A browser pass): the flags store says when the first
 * real answer has arrived, so a page can tell "this flag is off" from "the
 * flags have not arrived yet".
 */
let store;
beforeEach(async () => {
  vi.resetModules();
  ({ flagsStore: store } = await import('@shared/config/FlagsContext'));
  store.__reset();
});

describe('flagsStore loaded', () => {
  it('is false on the defaults, true after the first answer (even one that changes nothing)', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.isLoaded()).toBe(false);
    store.setFromRemote({}); // all defaults: no flag changes
    expect(store.isLoaded()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is true when the flags cannot be fetched (the app runs on defaults)', () => {
    store.markLoaded();
    expect(store.isLoaded()).toBe(true);
  });

  it('a second answer that changes nothing notifies no one', () => {
    store.setFromRemote({});
    const listener = vi.fn();
    store.subscribe(listener);
    store.setFromRemote({});
    expect(listener).not.toHaveBeenCalled();
  });
});
