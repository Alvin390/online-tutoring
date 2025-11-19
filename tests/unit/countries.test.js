import { describe, it, expect } from 'vitest';
import {
  countries,
  getCountryByCode,
  getCountryByDial,
  validatePhoneNumber,
  formatPhoneNumber
} from '@shared/constants/countries';

describe('Countries Constants', () => {
  it('should export 50 countries', () => {
    expect(countries).toBeDefined();
    expect(countries.length).toBe(50);
  });

  it('should have Kenya as first country', () => {
    expect(countries[0].code).toBe('KE');
    expect(countries[0].name).toBe('Kenya');
    expect(countries[0].dial).toBe('+254');
    expect(countries[0].length).toBe(9);
  });

  it('should find country by code', () => {
    const kenya = getCountryByCode('KE');
    expect(kenya).toBeDefined();
    expect(kenya.name).toBe('Kenya');
    expect(kenya.dial).toBe('+254');
  });

  it('should return undefined for invalid country code', () => {
    const invalid = getCountryByCode('XX');
    expect(invalid).toBeUndefined();
  });

  it('should find country by dial code', () => {
    const kenya = getCountryByDial('+254');
    expect(kenya).toBeDefined();
    expect(kenya.code).toBe('KE');
    expect(kenya.name).toBe('Kenya');
  });

  it('should return undefined for invalid dial code', () => {
    const invalid = getCountryByDial('+999');
    expect(invalid).toBeUndefined();
  });

  it('should validate correct phone number length', () => {
    const kenya = getCountryByCode('KE');
    expect(validatePhoneNumber(kenya, '712345678')).toBe(true);
  });

  it('should reject incorrect phone number length', () => {
    const kenya = getCountryByCode('KE');
    expect(validatePhoneNumber(kenya, '12345')).toBe(false);
    expect(validatePhoneNumber(kenya, '71234567890')).toBe(false);
  });

  it('should format phone number according to country format', () => {
    const kenya = getCountryByCode('KE');
    const formatted = formatPhoneNumber(kenya, '712345678');
    expect(formatted).toBe('712 345 678');
  });

  it('should handle phone number with non-digits in formatting', () => {
    const kenya = getCountryByCode('KE');
    const formatted = formatPhoneNumber(kenya, '712-345-678');
    expect(formatted).toBe('712 345 678');
  });

  it('should validate USA phone numbers', () => {
    const usa = getCountryByCode('US');
    expect(validatePhoneNumber(usa, '2025551234')).toBe(true);
    expect(validatePhoneNumber(usa, '12345')).toBe(false);
  });

  it('should validate UK phone numbers', () => {
    const uk = getCountryByCode('GB');
    expect(validatePhoneNumber(uk, '7911123456')).toBe(true);
    expect(validatePhoneNumber(uk, '123')).toBe(false);
  });

  it('should have all required fields for each country', () => {
    countries.forEach(country => {
      expect(country).toHaveProperty('code');
      expect(country).toHaveProperty('name');
      expect(country).toHaveProperty('flag');
      expect(country).toHaveProperty('dial');
      expect(country).toHaveProperty('format');
      expect(country).toHaveProperty('length');
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.dial).toMatch(/^\+\d+$/);
      expect(typeof country.length).toBe('number');
      expect(country.length).toBeGreaterThan(0);
    });
  });
});
