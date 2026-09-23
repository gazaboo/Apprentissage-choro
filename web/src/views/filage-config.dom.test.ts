import { describe, expect, it, vi } from 'vitest';
import { renderFilageConfig, type FilageConfigContext } from './filage-config';
import type { Progress } from '../store';

function baseProgress(overrides: Partial<Progress['settings']> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    techniqueSetlists: [],
    activeTechniqueSetlistId: null,
    techniquePresetsSeeded: false,
    sessions: [],
    _rev: 0,
    settings: {
      blockMinutes: 5,
      display: 'partition',
      studyMode: 'mesures',
      maskLevel: 50,
      maskSeed: 1,
      eclipseIntensity: 'moyennes',
      instrumentDefault: 'c',
      contrechant: 'sans',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
      ...overrides,
    },
  };
}

function mount(overrides: Partial<FilageConfigContext> = {}) {
  const root = document.createElement('div');
  const context: FilageConfigContext = {
    progress: baseProgress(),
    setlistName: 'Concert du 12',
    songCount: 5,
    navigateHome: vi.fn(),
    onStart: vi.fn(),
    ...overrides,
  };
  const teardown = renderFilageConfig(root, context);
  return { root, context, teardown };
}

describe('renderFilageConfig — smoke', () => {
  it('rend sans lever et affiche le contexte de la setlist', () => {
    const { root } = mount();
    expect(root.textContent).toContain('Concert du 12');
    expect(root.textContent).toContain('5 morceaux');
  });

  it('teardown ne lève pas', () => {
    const { teardown } = mount();
    expect(() => teardown()).not.toThrow();
  });
});

describe('renderFilageConfig — interactions', () => {
  it('« Commencer le filage » démarre avec les choix par défaut (Ut, Original)', () => {
    const { root, context } = mount();
    const start = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Commencer le filage',
    )!;
    start.click();
    expect(context.onStart).toHaveBeenCalledWith('c', 'reference');
  });

  it('changer la partition et la bande avant de démarrer transmet les nouveaux choix', () => {
    const { root, context } = mount();
    const bbButton = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Si♭ / B♭')!;
    const playbackButton = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Playback')!;
    bbButton.click();
    playbackButton.click();
    const start = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Commencer le filage',
    )!;
    start.click();
    expect(context.onStart).toHaveBeenCalledWith('bb', 'playback');
  });

  it('« Retour » appelle navigateHome()', () => {
    const { root, context } = mount();
    const back = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retour')!;
    back.click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });
});
