import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError } from '@services/api/client';
import {
  groupApiError, prepareEvent, releaseName, reportApiFailure, addFlowBreadcrumb, routeTag, __setSentryForTest,
} from '@utils/monitoring';

/**
 * 002Fixes / 01 — Sentry tells the problems apart.
 *
 * On 26 Oct timeouts, 429s and empty-phone 400s all landed in the same two
 * issues because every ApiError shares one minified top frame.
 */

afterEach(() => __setSentryForTest(null));

const apiError = (code, status, path = '/api/student/checkin') => new ApiError('x', { code, status, path });

describe('grouping', () => {
  it('fingerprints an API failure by endpoint and code, and tags it', () => {
    const out = groupApiError({ tags: { route: 'session-page' } }, { originalException: apiError('rate_limited', 429) });
    expect(out.fingerprint).toEqual(['api-error', '/api/student/checkin', 'rate_limited']);
    expect(out.tags).toEqual({ route: 'session-page', api_path: '/api/student/checkin', api_code: 'rate_limited', api_status: '429' });
  });

  it('a timeout, a 429 and a 400 on the same endpoint become three different issues', () => {
    const prints = [['timeout', 0], ['rate_limited', 429], ['validation_failed', 400]]
      .map(([code, status]) => groupApiError({}, { originalException: apiError(code, status) }).fingerprint.join('|'));
    expect(new Set(prints).size).toBe(3);
  });

  it('leaves every other error to Sentry\'s own grouping', () => {
    const event = { tags: { a: '1' } };
    expect(groupApiError(event, { originalException: new TypeError('boom') })).toBe(event);
    expect(groupApiError(event, undefined)).toBe(event);
  });
});

describe('prepareEvent (the real beforeSend)', () => {
  it('adds the route tag, groups, and still redacts', () => {
    const out = prepareEvent(
      {
        message: 'refused for +254712345678',
        exception: { values: [{ value: 'phone: must be valid, got +254712345678' }] },
        breadcrumbs: [{ category: 'checkin.flow', message: 'action', data: { action: 'refresh', numberLength: 0, numberEmpty: true } }],
      },
      { originalException: apiError('validation_failed', 400) }
    );
    expect(out.tags).toMatchObject({ route: routeTag(window.location.pathname), api_code: 'validation_failed', api_status: '400' });
    expect(out.fingerprint).toEqual(['api-error', '/api/student/checkin', 'validation_failed']);
    // The flow breadcrumb's shape survives redaction…
    expect(out.breadcrumbs[0].data).toEqual({ action: 'refresh', numberLength: 0, numberEmpty: true });
    // …and no phone digits leave in any field.
    expect(JSON.stringify(out)).not.toMatch(/712345/);
  });
});

describe('release name', () => {
  it('includes the commit when the build knows it', () => {
    expect(releaseName('2.0.0', '5dd6570')).toBe('online-tutoring@2.0.0+5dd6570');
    expect(releaseName('2.0.0', '')).toBe('online-tutoring@2.0.0');
    expect(releaseName(undefined, '5dd6570')).toBeUndefined();
  });
});

describe('handled failures and flow breadcrumbs', () => {
  it('an API failure is reported at warning level with the action and screen', () => {
    const captureException = vi.fn();
    __setSentryForTest({ captureException });
    const err = apiError('timeout', 0);
    reportApiFailure(err, { action: 'refresh', screen: 'pending' });
    expect(captureException).toHaveBeenCalledWith(err, { level: 'warning', tags: { flow_action: 'refresh', flow_screen: 'pending' } });
  });

  it('a non-API error is reported at error level (it is a bug)', () => {
    const captureException = vi.fn();
    __setSentryForTest({ captureException });
    reportApiFailure(new TypeError('boom'), { action: 'checkin', screen: 'checkin' });
    expect(captureException.mock.calls[0][1].level).toBe('error');
  });

  it('nothing is sent, and nothing throws, when Sentry is off', () => {
    expect(() => reportApiFailure(apiError('timeout', 0))).not.toThrow();
    expect(() => addFlowBreadcrumb('screen', { screen: 'checkin' })).not.toThrow();
  });

  it('flow breadcrumbs go to Sentry under their own category', () => {
    const addBreadcrumb = vi.fn();
    __setSentryForTest({ addBreadcrumb });
    addFlowBreadcrumb('action', { action: 'refresh', numberLength: 13, numberEmpty: false });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'checkin.flow', level: 'info', message: 'action', data: { action: 'refresh', numberLength: 13, numberEmpty: false },
    });
  });
});
