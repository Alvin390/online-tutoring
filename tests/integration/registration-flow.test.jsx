import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CheckinCard from '@features/registration/components/CheckinCard';
import CountrySelector from '@features/registration/components/CountrySelector';
import PhoneInput from '@features/registration/components/PhoneInput';

// Helper to wrap components with Router
const renderWithRouter = (component) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe('Registration Flow Integration', () => {
  describe('CountrySelector Component', () => {
    it('should render country selector with all countries', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <CountrySelector value={null} onChange={mockOnChange} error={null} />
      );

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      // Should have 50 countries + 1 placeholder option
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(51);
    });

    it('should show error message when provided', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <CountrySelector
          value={null}
          onChange={mockOnChange}
          error="Please select a country"
        />
      );

      expect(screen.getByText('Please select a country')).toBeInTheDocument();
    });

    it('should call onChange when country is selected', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <CountrySelector value={null} onChange={mockOnChange} error={null} />
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'KE' } });

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe('PhoneInput Component', () => {
    const mockCountry = {
      code: 'KE',
      name: 'Kenya',
      dial: '+254',
      format: '7XX XXX XXX',
      length: 9,
    };

    it('should render phone input with dial code', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <PhoneInput
          country={mockCountry}
          value=""
          onChange={mockOnChange}
          isValid={false}
          error={null}
        />
      );

      expect(screen.getByText('+254')).toBeInTheDocument();
      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
    });

    it('should be disabled when no country selected', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <PhoneInput
          country={null}
          value=""
          onChange={mockOnChange}
          isValid={false}
          error={null}
        />
      );

      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
    });

    it('should show validation feedback', () => {
      const mockOnChange = vi.fn();
      const { rerender } = renderWithRouter(
        <PhoneInput
          country={mockCountry}
          value="712345678"
          onChange={mockOnChange}
          isValid={true}
          error={null}
        />
      );

      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('is-valid');

      rerender(
        <BrowserRouter>
          <PhoneInput
            country={mockCountry}
            value="123"
            onChange={mockOnChange}
            isValid={false}
            error="Invalid phone number"
          />
        </BrowserRouter>
      );

      expect(input).toHaveClass('is-invalid');
      expect(screen.getByText('Invalid phone number')).toBeInTheDocument();
    });

    it('should show helper text with required length', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <PhoneInput
          country={mockCountry}
          value=""
          onChange={mockOnChange}
          isValid={false}
          error={null}
        />
      );

      expect(screen.getByText(/Enter 9-digit phone number/)).toBeInTheDocument();
    });

    it('should enforce maxLength based on country', () => {
      const mockOnChange = vi.fn();
      renderWithRouter(
        <PhoneInput
          country={mockCountry}
          value=""
          onChange={mockOnChange}
          isValid={false}
          error={null}
        />
      );

      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('maxLength', '9');
    });
  });

  describe('CheckinCard Component', () => {
    it('should render checkin card with all elements', async () => {
      const mockOnSubmit = vi.fn();
      renderWithRouter(
        <CheckinCard session="morning" onSubmit={mockOnSubmit} loading={false} />
      );

      await waitFor(() => {
        expect(screen.getByText('Welcome to Class')).toBeInTheDocument();
        expect(screen.getByText(/Enter your parent's phone number/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument();
      });
    });

    it('should show loading state', () => {
      const mockOnSubmit = vi.fn();
      renderWithRouter(
        <CheckinCard session="morning" onSubmit={mockOnSubmit} loading={true} />
      );

      expect(screen.getByText(/Checking registration/i)).toBeInTheDocument();
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('should validate before submission', async () => {
      const mockOnSubmit = vi.fn();
      renderWithRouter(
        <CheckinCard session="morning" onSubmit={mockOnSubmit} loading={false} />
      );

      await waitFor(() => {
        const button = screen.getByRole('button', { name: /Continue/i });
        fireEvent.click(button);
      });

      // Should not call onSubmit without valid data
      await waitFor(() => {
        expect(mockOnSubmit).not.toHaveBeenCalled();
      });
    });
  });
});
