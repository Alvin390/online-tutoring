import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { highlight, escapeRegExp } from '@utils/highlight';

/**
 * Note search highlighting — Phase 05 Part B.
 *
 * Note bodies are free text typed by the teacher and rendered back into the
 * dashboard. Building an HTML string to add a <mark> would turn the one field
 * designed to hold arbitrary prose into a stored-XSS sink, so this returns
 * React nodes and relies on React's text-node escaping.
 */

describe('highlight', () => {
  it('returns the plain string when there is no search term', () => {
    expect(highlight('hello world', '')).toBe('hello world');
    expect(highlight('hello world', null)).toBe('hello world');
    expect(highlight('hello world', '   ')).toBe('hello world');
  });

  it('wraps a match in <mark>', () => {
    render(<p>{highlight('weak in algebra', 'algebra')}</p>);
    const mark = screen.getByText('algebra');
    expect(mark.tagName).toBe('MARK');
  });

  it('matches case-insensitively but preserves the original casing', () => {
    render(<p>{highlight('Weak in Algebra', 'algebra')}</p>);
    expect(screen.getByText('Algebra').tagName).toBe('MARK');
  });

  it('highlights every occurrence', () => {
    const { container } = render(<p>{highlight('math and more math', 'math')}</p>);
    expect(container.querySelectorAll('mark')).toHaveLength(2);
  });

  it('renders HTML in the note body as TEXT, never as markup', () => {
    // The whole point. If this ever renders a real element, note bodies have
    // become an injection vector.
    const malicious = '<img src=x onerror="alert(1)">';
    const { container } = render(<p>{highlight(malicious, 'img')}</p>);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=');
  });

  it('does not execute a script tag in the search term either', () => {
    const { container } = render(
      <p>{highlight('some note about <script>', '<script>')}</p>
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('<script>');
  });

  it('survives regex metacharacters in the search term', () => {
    // An unescaped '(' would throw; '.*' would match everything.
    expect(() => highlight('C++ and (a)', '(')).not.toThrow();
    expect(() => highlight('anything', '.*')).not.toThrow();
    expect(() => highlight('anything', '[')).not.toThrow();

    const { container } = render(<p>{highlight('grade 8.5 result', '.*')}</p>);
    // '.*' is treated literally, so nothing matches.
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('handles a null or undefined body', () => {
    expect(highlight(null, 'x')).toBe('');
    expect(highlight(undefined, 'x')).toBe('');
  });
});

describe('escapeRegExp', () => {
  it('escapes every metacharacter', () => {
    const escaped = escapeRegExp('.*+?^${}()|[]\\');
    expect(() => new RegExp(escaped)).not.toThrow();
    expect(new RegExp(escaped).test('.*+?^${}()|[]\\')).toBe(true);
  });
});
