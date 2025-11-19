import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhoneValidation } from '@features/registration/hooks/usePhoneValidation';
import { countries } from '@shared/constants/countries';

describe('usePhoneValidation', () => {
  it('should initialize with no selected country', () => {
    const { result } = renderHook(() => usePhoneValidation());

    expect(result.current.selectedCountry).toBeNull();
    expect(result.current.phoneNumber).toBe('');
    expect(result.current.isValid).toBe(false);
  });

  it('should handle country selection', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    expect(result.current.selectedCountry?.code).toBe('KE');
    expect(result.current.selectedCountry?.dial).toBe('+254');
    expect(result.current.phoneNumber).toBe('');
    expect(result.current.isValid).toBe(false);
  });

  it('should validate phone numbers correctly for Kenya', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    // Enter valid Kenyan number (9 digits)
    act(() => {
      result.current.handlePhoneChange('712345678');
    });

    expect(result.current.phoneNumber).toBe('712345678');
    expect(result.current.isValid).toBe(true);
  });

  it('should reject invalid phone numbers (too short)', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    // Enter invalid number (too short)
    act(() => {
      result.current.handlePhoneChange('12345');
    });

    expect(result.current.isValid).toBe(false);
  });

  it('should remove non-digit characters', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    // Enter number with non-digits
    act(() => {
      result.current.handlePhoneChange('712-345-678');
    });

    expect(result.current.phoneNumber).toBe('712345678');
    expect(result.current.isValid).toBe(true);
  });

  it('should limit phone number to country length', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    // Try to enter more than 9 digits
    act(() => {
      result.current.handlePhoneChange('71234567890');
    });

    expect(result.current.phoneNumber).toBe('712345678');
    expect(result.current.phoneNumber.length).toBe(9);
  });

  it('should return full international phone number', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    act(() => {
      result.current.handlePhoneChange('712345678');
    });

    const fullPhone = result.current.getFullPhoneNumber();
    expect(fullPhone).toBe('+254712345678');
  });

  it('should reset phone number when changing country', () => {
    const { result } = renderHook(() => usePhoneValidation());
    const kenya = countries.find(c => c.code === 'KE');
    const usa = countries.find(c => c.code === 'US');

    act(() => {
      result.current.handleCountryChange(kenya);
    });

    act(() => {
      result.current.handlePhoneChange('712345678');
    });

    expect(result.current.phoneNumber).toBe('712345678');

    // Change country
    act(() => {
      result.current.handleCountryChange(usa);
    });

    expect(result.current.selectedCountry?.code).toBe('US');
    expect(result.current.phoneNumber).toBe('');
    expect(result.current.isValid).toBe(false);
  });
});
