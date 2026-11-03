import { describe, it, expect } from 'vitest';
import { describeDevice } from '../../../api/_lib/device.js';

/**
 * 004Fixes / 05 — a short, lasting note of which device made a staff change
 * (browser + OS + Cloudflare's network name). Cloudflare's own request logs
 * keep only 3 days; on 30 Oct the device was what told a confirmed undo from a
 * stray click. Never an IP address, never the whole user-agent string.
 */

const req = (ua, network) => ({ headers: ua === undefined ? {} : { 'user-agent': ua }, network });

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', 'Chrome 155', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:159.0) Gecko/20100101 Firefox/159.0', 'Firefox 159', 'Windows'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36', 'Chrome 156', 'Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari 18', 'iPhone'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/155.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome 155', 'iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0', 'Edge 155', 'Windows'],
    ['Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'Samsung Internet 27', 'Android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari 18', 'macOS'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', 'Chrome 155', 'ChromeOS'],
  ])('%#: %s', (ua, browser, os) => {
    expect(describeDevice(req(ua))).toEqual({ browser, os, network: null });
  });

  it('keeps Cloudflare\'s network name, trimmed to 60 characters', () => {
    expect(describeDevice(req('Mozilla/5.0 (Windows NT 10.0) Firefox/159.0', 'KE-SFC-GPRS-EDGE-3G-LTE-Mobile WiFi-SERVICE-IP')).network)
      .toBe('KE-SFC-GPRS-EDGE-3G-LTE-Mobile WiFi-SERVICE-IP');
    expect(describeDevice(req('x', 'n'.repeat(80))).network).toHaveLength(60);
  });

  it('an unknown or missing user-agent gives nulls, never the raw string', () => {
    expect(describeDevice(req('curl/8.4.0'))).toEqual({ browser: null, os: null, network: null });
    expect(describeDevice(req(undefined))).toEqual({ browser: null, os: null, network: null });
    expect(describeDevice(null)).toEqual({ browser: null, os: null, network: null });
  });

  it('never carries an IP address', () => {
    const d = describeDevice({ headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/155.0', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9' }, network: null });
    expect(JSON.stringify(d)).not.toContain('203.0.113');
  });
});
