import { describe, expect, it, vi } from 'vitest';
import { renderDashboard, type DashboardContext } from './dashboard';
import type { Progress } from '../store';
import type { Song } from '../types';

function song(id: string, title = id): Song {
  return {
    id,
    title,
    composer: 'Pixinguinha',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 1, measure_count: 1, pages: [] }],
  };
}

function baseProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    sessions: [],
    _rev: 0,
    settings: {
      blockMinutes: 5,
      display: 'partition',
      studyMode: 'mesures',
      maskLevel: 50,
      maskSeed: 1,
      eclipseIntensity: 'moyennes',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
    },
    ...overrides,
  };
}

function mountDashboard(songs: Song[], contextOverrides: Partial<DashboardContext> = {}) {
  const root = document.createElement('div');
  const context: DashboardContext = {
    progress: baseProgress(),
    openSong: vi.fn(),
    openAccount: vi.fn(),
    openAbout: vi.fn(),
    startSession: vi.fn(),
    startFilage: vi.fn(),
    openTechnique: vi.fn(),
    techniqueCount: 0,
    ...contextOverrides,
  };
  const teardown = renderDashboard(root, songs, context);
  return { root, context, teardown };
}

describe('renderDashboard — smoke', () => {
  it('rend le titre et une ligne par morceau, sans lever', () => {
    const { root } = mountDashboard([song('a', 'Carinhoso'), song('b', 'Tico-Tico')]);
    expect(root.querySelector('h1')?.textContent).toBe('Répertoire de choros');
    expect(root.textContent).toContain('Carinhoso');
    expect(root.textContent).toContain('Tico-Tico');
  });

  it('teardown ne lève pas et ne laisse pas de minuteur', () => {
    vi.useFakeTimers();
    const { teardown } = mountDashboard([song('a')]);
    expect(() => teardown()).not.toThrow();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});

describe('renderDashboard — CTA', () => {
  it('« Parcourir tout le répertoire » (aucune setlist active) déclenche startSession("deep")', () => {
    const { root, context } = mountDashboard([song('a')]);
    const button = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Parcourir tout le répertoire',
    );
    expect(button).toBeDefined();
    button!.click();
    expect(context.startSession).toHaveBeenCalledWith('deep');
  });

  it('le bouton urgences déclenche startSession("urgent")', () => {
    const { root, context } = mountDashboard([song('a')]);
    const button = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Réviser'),
    );
    button!.click();
    expect(context.startSession).toHaveBeenCalledWith('urgent');
  });

  it('« Préparer un filage » déclenche startFilage()', () => {
    const { root, context } = mountDashboard([song('a')]);
    const button = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Préparer un filage',
    );
    button!.click();
    expect(context.startFilage).toHaveBeenCalledOnce();
  });

  it('la rangée technique appelle openTechnique() quand fourni', () => {
    const openTechnique = vi.fn();
    const { root } = mountDashboard([song('a')], { openTechnique, techniqueCount: 3 });
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Commencer');
    expect(button).toBeDefined();
    button!.click();
    expect(openTechnique).toHaveBeenCalledOnce();
  });

  it('la rangée technique affiche "Voir les exercices" quand `techniqueCount` est nul', () => {
    const { root } = mountDashboard([song('a')], { openTechnique: vi.fn(), techniqueCount: 0 });
    expect(root.textContent).toContain('Voir les exercices');
  });

  it('la section technique est absente quand `openTechnique` est `null`', () => {
    const { root } = mountDashboard([song('a')], { openTechnique: null });
    expect(root.textContent).not.toContain('Arpèges et gammes au métronome');
  });

  it('cliquer un morceau appelle openSong(id)', () => {
    const { root, context } = mountDashboard([song('a', 'Carinhoso')]);
    const row = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Carinhoso'),
    );
    row!.click();
    expect(context.openSong).toHaveBeenCalledWith('a');
  });

  it('cliquer l\'identité ouvre le compte', () => {
    const { root, context } = mountDashboard([song('a')]);
    const button = [...root.querySelectorAll('button')].find((b) =>
      b.getAttribute('title') === 'Compte et synchronisation',
    );
    button!.click();
    expect(context.openAccount).toHaveBeenCalledOnce();
  });
});
