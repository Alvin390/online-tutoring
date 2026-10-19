import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 13 / 08 — performance work with functional consequences.
 */

describe('C6b reload once when a chunk is missing after a deploy', () => {
  let win;
  let store;
  beforeEach(() => {
    store = new Map();
    const listeners = {};
    win = {
      sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      location: { reload: vi.fn() },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: vi.fn(),
      fire: (type) => {
        const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        listeners[type]?.(event);
        return event;
      },
    };
  });

  it('reloads on the first vite:preloadError and swallows it', async () => {
    const { installChunkReload } = await import('@utils/chunkReload');
    installChunkReload(win);
    const event = win.fire('vite:preloadError');
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not loop: a second failure right after reloading surfaces the error', async () => {
    const { installChunkReload } = await import('@utils/chunkReload');
    installChunkReload(win);
    win.fire('vite:preloadError');
    const second = win.fire('vite:preloadError');
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it('never auto-reloads when sessionStorage is unavailable (no loop guard)', async () => {
    const { installChunkReload } = await import('@utils/chunkReload');
    win.sessionStorage.getItem = () => { throw new Error('blocked'); };
    installChunkReload(win);
    win.fire('vite:preloadError');
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});

describe('C3 audit writes are off the response path', () => {
  async function setup() {
    vi.resetModules();
    let release;
    const pending = new Promise((r) => { release = r; });
    const add = vi.fn(() => pending);
    vi.doMock('../../../api/_lib/firebaseAdmin.js', () => ({
      getDb: () => ({ collection: () => ({ add }) }),
      FieldValue: { serverTimestamp: () => 'ts' },
    }));
    const { tryWriteAudit } = await import('../../../api/_lib/audit.js');
    const { runInRequestContext } = await import('../../../api/_lib/requestContext.js');
    return { tryWriteAudit, runInRequestContext, add, release };
  }

  it('inside an invocation: returns immediately and hands the write to waitUntil', async () => {
    const { tryWriteAudit, runInRequestContext, add, release } = await setup();
    const background = [];
    let returned = false;
    await runInRequestContext({ waitUntil: (p) => background.push(p) }, async () => {
      await tryWriteAudit({ action: 'test.action', actor: 'u1' });
      returned = true;
    });
    expect(returned).toBe(true);           // did not wait for the write
    expect(add).toHaveBeenCalledTimes(1);  // the write was started
    expect(background).toHaveLength(1);    // and kept alive by the runtime
    release();
    await Promise.all(background);
    vi.doUnmock('../../../api/_lib/firebaseAdmin.js');
  });

  it('outside an invocation (scripts): still awaits the write', async () => {
    const { tryWriteAudit, release } = await setup();
    let done = false;
    const p = tryWriteAudit({ action: 'test.action', actor: 'u1' }).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
    vi.doUnmock('../../../api/_lib/firebaseAdmin.js');
  });
});

describe('D4 guard: public pages never reach Firebase', () => {
  it('no static import path from LandingPage or SessionRoutePage leads to firebase/*', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const path = await import('node:path');
    const root = process.cwd();
    const alias = {
      '@features/': 'src/features/', '@shared/': 'src/shared/', '@services/': 'src/services/',
      '@utils/': 'src/shared/utils/', '@hooks/': 'src/shared/hooks/', '@components/': 'src/shared/components/', '@/': 'src/',
    };
    const resolveSpec = (spec, from) => {
      let base = null;
      if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
      else {
        const hit = Object.keys(alias).find((a) => spec.startsWith(a));
        if (!hit) return null; // a package
        base = path.resolve(root, alias[hit] + spec.slice(hit.length));
      }
      for (const ext of ['', '.js', '.jsx', '/index.js', '/index.jsx']) {
        if (existsSync(base + ext) && !base.endsWith('/') && (ext || /\.(jsx?|css)$/.test(base))) return base + ext;
      }
      return null;
    };
    // STATIC imports only: `import x from`, `import 'x'`, `export … from`.
    const staticSpecs = (code) => [
      ...code.matchAll(/^\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/gm),
      ...code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1]);

    const offenders = [];
    const seen = new Set();
    const walk = (file, trail) => {
      if (seen.has(file) || !/\.jsx?$/.test(file)) return;
      seen.add(file);
      for (const spec of staticSpecs(readFileSync(file, 'utf8'))) {
        if (/^firebase(\/|$)|^@firebase\//.test(spec)) offenders.push([...trail, spec].join(' → '));
        const next = resolveSpec(spec, file);
        if (next) walk(next, [...trail, path.relative(root, next)]);
      }
    };
    for (const page of ['src/pages/LandingPage.jsx', 'src/pages/SessionRoutePage.jsx']) {
      walk(path.resolve(root, page), [page]);
    }
    expect(offenders).toEqual([]);
    expect(seen.size).toBeGreaterThan(10); // the walk really followed the graph
  });
});

describe('B5 sign-out removes the offline roster from this computer', () => {
  async function signOutWith({ wipe }) {
    vi.resetModules();
    const order = [];
    vi.doMock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: vi.fn(() => () => {}) }));
    vi.doMock('@services/firebase/auth', () => ({
      onAuthChange: vi.fn(() => () => {}),
      signIn: vi.fn(),
      signOut: vi.fn(async () => { order.push('signOut'); return { success: true }; }),
    }));
    vi.doMock('@services/firebase/config', () => ({
      auth: { currentUser: null }, db: {},
      wipeLocalData: vi.fn(async () => { order.push('wipe'); if (wipe === 'fail') throw new Error('blocked'); }),
    }));
    vi.doMock('@utils/analytics', () => ({ trackLogin: vi.fn() }));
    vi.doMock('@services/api/auth', () => ({ recordLoginAttempt: vi.fn() }));
    const replace = vi.fn(() => order.push('replace'));
    const reload = vi.fn(() => order.push('reload'));
    const realLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, replace, reload } });
    try {
      const { renderHook, act } = await import('@testing-library/react');
      const { AuthProvider, useAuthActions } = await import('@features/auth/context/AuthContext.jsx');
      const { result } = renderHook(() => useAuthActions(), { wrapper: AuthProvider });
      await act(async () => { await result.current.signOut({ redirectTo: '/' }); });
      return { order, replace, reload };
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
      for (const m of ['firebase/firestore', '@services/firebase/auth', '@services/firebase/config', '@utils/analytics', '@services/api/auth']) vi.doUnmock(m);
    }
  }

  it('signs out, wipes the cache, THEN reloads to the chosen page', async () => {
    const { order, replace } = await signOutWith({});
    expect(order).toEqual(['signOut', 'wipe', 'replace']);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('still leaves the page if the wipe fails (blocked storage)', async () => {
    const { order } = await signOutWith({ wipe: 'fail' });
    expect(order).toEqual(['signOut', 'wipe', 'replace']);
  });
});

describe('D2 real-user monitoring', () => {
  it('tags pages coarsely: every class page is one value, never its slug', async () => {
    const { routeTag } = await import('@utils/monitoring');
    expect(routeTag('/')).toBe('home');
    expect(routeTag('/dashboard/')).toBe('dashboard');
    expect(routeTag('/billing')).toBe('billing');
    expect(routeTag('/morning')).toBe('session-page');
    expect(routeTag('/weekend-revision')).toBe('session-page');
    expect(routeTag('/a/b')).toBe('other');
  });

  it('long tasks over 200 ms become breadcrumbs with their page; shorter ones are ignored', async () => {
    const { observeLongTasks, __setSentryForTest } = await import('@utils/monitoring');
    const addBreadcrumb = vi.fn();
    __setSentryForTest({ addBreadcrumb });
    let callback;
    class FakeObserver {
      static supportedEntryTypes = ['longtask'];
      constructor(cb) { callback = cb; }
      observe() {}
    }
    observeLongTasks(FakeObserver);
    callback({ getEntries: () => [{ duration: 120 }, { duration: 340.6 }] });
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb.mock.calls[0][0]).toMatchObject({ category: 'perf.longtask', data: { ms: 341 } });
    __setSentryForTest(null);
  });
});
