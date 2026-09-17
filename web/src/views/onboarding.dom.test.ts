import { describe, expect, it, vi } from 'vitest';
import { renderOnboarding, type OnboardingContext } from './onboarding';
import type { Song } from '../types';

function mount(overrides: Partial<OnboardingContext> = {}) {
  const root = document.createElement('div');
  const context: OnboardingContext = {
    songs: [] as Song[],
    onComplete: vi.fn(),
    ...overrides,
  };
  const teardown = renderOnboarding(root, context);
  return { root, context, teardown };
}

function findButton(root: HTMLElement, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!button) throw new Error(`bouton "${text}" introuvable`);
  return button;
}

describe('renderOnboarding — smoke', () => {
  it('rend le titre et le CTA', () => {
    const { root } = mount();
    expect(root.textContent).toContain('Réglages par défaut');
    expect(root.textContent).toContain('Modifiable à tout moment plus tard.');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Continuer')).toBe(
      true,
    );
  });

  it('teardown ne lève pas', () => {
    const { teardown } = mount();
    expect(() => teardown()).not.toThrow();
  });

  it('la question contre-chant est absente tant qu\'aucune donnée contraponto n\'existe', () => {
    const { root } = mount();
    expect(root.textContent).not.toContain('contre-chant');
  });
});

describe('renderOnboarding — interactions', () => {
  it('« Continuer » transmet les choix par défaut sans interaction', () => {
    const { root, context } = mount();
    findButton(root, 'Continuer').click();
    expect(context.onComplete).toHaveBeenCalledWith({
      instrumentDefault: 'c',
      display: 'partition',
      contrechant: 'sans',
    });
  });

  it('changer la tonalité et l\'affichage avant de continuer transmet les nouveaux choix', () => {
    const { root, context } = mount();
    findButton(root, 'Si♭ / B♭').click();
    findButton(root, 'Grille d’accords').click();
    findButton(root, 'Continuer').click();
    expect(context.onComplete).toHaveBeenCalledWith({
      instrumentDefault: 'bb',
      display: 'grille',
      contrechant: 'sans',
    });
  });
});
