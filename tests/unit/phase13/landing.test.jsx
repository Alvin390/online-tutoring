import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Homepage layout. `.hero-section` is a flex container (landing.css); the
 * features section and footer used to be rendered INSIDE it, so on desktop
 * they were laid out side by side with the hero and squeezed the session
 * cards into narrow columns ("Morni-ng Sessio-n"). As in the original design,
 * the hero now closes before them.
 */

vi.mock('@features/sessions/hooks/usePublicSessions', () => ({
  usePublicSessions: () => ({
    loading: false,
    fallback: true,
    sessions: [
      { id: 'morning', slug: 'morning', name: 'Morning Session' },
      { id: 'evening', slug: 'evening', name: 'Evening Session' },
    ],
  }),
}));

describe('homepage structure', () => {
  it('the features section and footer are siblings of the hero, not inside it', async () => {
    const { default: LandingPage } = await import('@/pages/LandingPage.jsx');
    const { container } = render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const hero = container.querySelector('.hero-section');
    const features = container.querySelector('.features-section');
    const footer = container.querySelector('footer.footer');
    expect(hero).toBeTruthy();
    expect(hero.contains(features)).toBe(false);
    expect(hero.contains(footer)).toBe(false);
    // Hero first, then features, then footer.
    expect(hero.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(features.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The session cards are inside the hero.
    expect(hero.querySelectorAll('a[href="/morning"], a[href="/evening"]').length).toBe(2);
  });

  it('every feature has a real Bootstrap Icons glyph', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('node_modules/bootstrap-icons/font/bootstrap-icons.css', 'utf8');
    const { default: LandingPage } = await import('@/pages/LandingPage.jsx');
    const { container } = render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const icons = [...container.querySelectorAll('.feature-icon i')].map((i) => [...i.classList].find((c) => c.startsWith('bi-')));
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(css).toContain(`.${icon}::before`);
  });
});
