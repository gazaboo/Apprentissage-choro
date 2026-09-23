import { describe, expect, it, vi } from 'vitest';
import { renderDashboard, type DashboardContext } from './dashboard';
import { cardKey, type Progress } from '../store';
import type { InstrumentId, Song, SrsCard, StudyMode } from '../types';

function song(id: string, title = id): Song {
  return {
    id,
    title,
    composer: 'Pixinguinha',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 1, measure_count: 1, pages: [] }],
    contraponto: null,
  };
}

function baseProgress(overrides: Partial<Progress> = {}): Progress {
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
    },
    ...overrides,
  };
}

function mountDashboard(songs: Song[], contextOverrides: Partial<DashboardContext> = {}) {
  const root = document.createElement('div');
  const context: DashboardContext = {
    progress: baseProgress(),
    openSong: vi.fn(),
    startSession: vi.fn(),
    startFilage: vi.fn(),
    ...contextOverrides,
  };
  const teardown = renderDashboard(root, songs, context);
  return { root, context, teardown };
}

describe('renderDashboard — smoke', () => {
  it('rend le titre et une ligne par morceau, sans lever', () => {
    const { root } = mountDashboard([song('a', 'Carinhoso'), song('b', 'Tico-Tico')]);
    expect(root.querySelector('h1')?.textContent).toBe('Répertoire');
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

  it('range la liste par ordre alphabétique', () => {
    const { root } = mountDashboard([song('z', 'Tico-Tico'), song('y', 'Atraente'), song('x', 'Benzinho')]);
    const list = root.querySelector('section:not([aria-label])')!;
    const titles = [...list.querySelectorAll('button span.block.truncate.text-base')].map((s) => s.textContent);
    expect(titles).toEqual(['Atraente', 'Benzinho', 'Tico-Tico']);
  });

  it('parle de morceaux travaillés, pas de morceaux à travailler', () => {
    const { root } = mountDashboard([song('a'), song('b')], {
      progress: baseProgress(withCard('a', 'c', cardWith([4]))),
    });
    expect(root.textContent).toContain('2 morceaux · 1 travaillé');
    expect(root.textContent).not.toContain('à travailler');
    expect(root.textContent).not.toContain('retard');
  });
});

function withCard(songId: string, instrumentId: InstrumentId, card: SrsCard): Partial<Progress> {
  return { cards: { [cardKey(songId, instrumentId)]: card } };
}

function cardWith(grades: number[], mode?: StudyMode): SrsCard {
  return {
    ease: 2.5,
    interval: 6,
    repetitions: grades.length,
    due: '2099-01-01',
    history: grades.map((grade, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      grade,
      tempo: 'fluide' as const,
      hints: 0,
      ...(mode ? { mode } : {}),
    })),
  };
}

describe('renderDashboard — parcours', () => {
  it("n'affiche pas de parcours pour un morceau jamais travaillé", () => {
    const { root } = mountDashboard([song('a')]);
    expect(root.querySelectorAll('[data-parcours]')).toHaveLength(0);
  });

  it('une case par séance, avec ou sans partition, et le nombre de séances en toutes lettres', () => {
    const card = cardWith([4, 4]);
    card.history[0]!.mode = 'entiere';
    card.history[1]!.mode = 'sans';
    const { root } = mountDashboard([song('a', 'Carinhoso')], {
      progress: baseProgress(withCard('a', 'c', card)),
    });
    const row = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Carinhoso') && b.querySelector('[role="img"]'))!;
    const cells = [...row.querySelectorAll('[data-parcours]')].map((c) => c.getAttribute('data-parcours'));
    expect(cells).toEqual(['partition', 'par-coeur']);
    expect(row.textContent).toContain('2 séances');
  });

  it('plafonne le parcours aux 8 dernières séances', () => {
    const { root } = mountDashboard([song('a', 'Carinhoso')], {
      progress: baseProgress(withCard('a', 'c', cardWith(Array(20).fill(4), 'entiere'))),
    });
    const trail = root.querySelector('[role="img"]')!;
    expect(trail.querySelectorAll('[data-parcours]')).toHaveLength(8);
    expect(root.textContent).toContain('20 séances');
  });
});

describe('renderDashboard — carte « Morceaux prioritaires »', () => {
  it('annonce le mode de chaque morceau prioritaire', () => {
    // Deux révisions réussies, nombre pair : recommendedMode propose « sans ».
    const { root } = mountDashboard([song('a', 'Carinhoso'), song('b', 'Odeon')], {
      progress: baseProgress(withCard('a', 'c', cardWith([5, 5]))),
    });
    const card = root.querySelector('section[aria-label="Morceaux prioritaires"]')!;
    const lines = [...card.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines).toContain('CarinhosoSans partition');
    expect(lines).toContain('OdeonAvec partition');
  });

  it('« Commencer la séance » lance exactement les morceaux annoncés', () => {
    const { root, context } = mountDashboard([song('a', 'Carinhoso')]);
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Commencer la séance')!;
    button.click();
    expect(context.startSession).toHaveBeenCalledWith('urgent', [
      expect.objectContaining({ song: expect.objectContaining({ id: 'a' }), instrumentId: 'c' }),
    ]);
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

  it('« Préparer un concert » reste accessible sans setlist et déclenche startFilage()', () => {
    const { root, context } = mountDashboard([song('a')]);
    const button = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Préparer un concert',
    );
    button!.click();
    expect(context.startFilage).toHaveBeenCalledOnce();
  });

  // Régression #76 : une setlist active proposait « Travailler toute la
  // setlist » en plus des urgences et du filage — trois façons de faire la
  // même chose. Restent la séance ciblée et le filage.
  it('setlist active : la séance ciblée et « Filer toute la setlist », rien d’autre', () => {
    const { root, context } = mountDashboard([song('a')], {
      progress: baseProgress({
        setlists: [{ id: 's1', name: 'Marmite des Adrets', songIds: ['a'], createdAt: '2026-01-01' }],
        activeSetlistId: 's1',
      }),
    });
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('Travailler toute la setlist');
    expect(labels).not.toContain('Parcourir tout le répertoire');
    expect(labels).toContain('Commencer la séance');
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Filer toute la setlist')!.click();
    expect(context.startFilage).toHaveBeenCalledOnce();
  });

  it('cliquer un morceau appelle openSong(id)', () => {
    const { root, context } = mountDashboard([song('a', 'Carinhoso')]);
    const row = [...root.querySelectorAll<HTMLButtonElement>('section:not([aria-label]) button')].find((b) =>
      b.textContent?.includes('Carinhoso'),
    );
    row!.click();
    expect(context.openSong).toHaveBeenCalledWith('a');
  });
});

describe('renderDashboard — pastille de setlist', () => {
  const progressWithSetlist = () =>
    baseProgress({
      setlists: [{ id: 's1', name: 'Roda du jeudi', songIds: ['a'], createdAt: '2026-01-01' }],
    });

  it('choisir une setlist dans le menu la rend active', () => {
    const progress = progressWithSetlist();
    const { root } = mountDashboard([song('a'), song('b')], { progress });
    const option = [...root.querySelectorAll('[role="menuitemradio"]')].find((b) =>
      b.textContent?.includes('Roda du jeudi'),
    ) as HTMLButtonElement;
    option.click();
    expect(progress.activeSetlistId).toBe('s1');
    expect(root.textContent).toContain('Toute la setlist');
  });

  it('chaque setlist a son bouton « Modifier », qui ouvre la modale sans activer la setlist', () => {
    const progress = progressWithSetlist();
    const { root, teardown } = mountDashboard([song('a')], { progress });
    const edit = root.querySelector('[aria-label="Modifier « Roda du jeudi »"]') as HTMLButtonElement;
    expect(edit).not.toBeNull();
    edit.click();
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Modifier la setlist',
    );
    expect(progress.activeSetlistId).toBeNull();
    teardown();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
