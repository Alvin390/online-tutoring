import { describe, it, expect, beforeEach, vi } from 'vitest';
import logger from '@utils/logger';

// Mock console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

describe('Logger Utility', () => {
  beforeEach(() => {
    // Mock console methods
    console.log = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.debug = vi.fn();

    // Clear log buffer
    logger.clearBuffer();
  });

  afterAll(() => {
    // Restore console
    Object.assign(console, originalConsole);
  });

  it('should have all logging methods', () => {
    expect(logger).toHaveProperty('debug');
    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('warn');
    expect(logger).toHaveProperty('error');
    expect(logger).toHaveProperty('getBuffer');
    expect(logger).toHaveProperty('clearBuffer');
    expect(logger).toHaveProperty('downloadLogs');
  });

  it('should log info messages', () => {
    logger.info('Test message');
    expect(console.info).toHaveBeenCalled();
  });

  it('should log info messages with metadata', () => {
    logger.info('Test message', { key: 'value' });
    expect(console.info).toHaveBeenCalled();
  });

  it('should log warning messages', () => {
    logger.warn('Warning message');
    expect(console.warn).toHaveBeenCalled();
  });

  it('should log error messages', () => {
    const error = new Error('Test error');
    logger.error('Error message', error);
    expect(console.error).toHaveBeenCalled();
  });

  it('should log debug messages', () => {
    logger.debug('Debug message');
    expect(console.debug).toHaveBeenCalled();
  });

  it('should store logs in buffer', () => {
    logger.info('Message 1');
    logger.warn('Message 2');
    logger.error('Message 3', new Error('Test'));

    const buffer = logger.getBuffer();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('should clear log buffer', () => {
    logger.info('Message 1');
    logger.info('Message 2');

    let buffer = logger.getBuffer();
    expect(buffer.length).toBeGreaterThan(0);

    logger.clearBuffer();
    buffer = logger.getBuffer();
    expect(buffer.length).toBe(0);
  });

  it('should format log entries with timestamp', () => {
    logger.info('Test message');
    const buffer = logger.getBuffer();

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toHaveProperty('timestamp');
    expect(buffer[0]).toHaveProperty('level');
    expect(buffer[0]).toHaveProperty('message');
  });

  it('should handle metadata in log entries', () => {
    const metadata = { userId: 123, action: 'test' };
    logger.info('Test with metadata', metadata);

    const buffer = logger.getBuffer();
    expect(buffer[0]).toHaveProperty('meta');
  });

  it('should limit buffer size to prevent memory issues', () => {
    // Add more than max logs (2000 is max according to original code)
    for (let i = 0; i < 2100; i++) {
      logger.info(`Message ${i}`);
    }

    const buffer = logger.getBuffer();
    expect(buffer.length).toBeLessThanOrEqual(2000);
  });
});
