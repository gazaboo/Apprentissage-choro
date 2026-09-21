import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeSetlist,
  cardKey,
  deleteSetlist,
  getCard,
  isDemoActive,
  loadProgress,
  persistMerged,
  putCard,
  recordSession,
  saveProgress,
  seedDemoProgress,
  setActiveSetlist,
  setAfterSave,
  stopDemo,
  upsertSetlist,
  type Progress,
} from './store';
import { recommendedMode } from './srs';
import type { SessionRun, Setlist, Song, SrsCard } from './types';

function baseProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    techniqueSetlists: [],
    activeTechniqueSetlistId: null,
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

/** Carte déjà migrée (avec `fsrs` valide) : le round-trip localStorage doit
 *  préserver la carte telle quelle, sans passer par le rejeu de `ensureFsrs`
 *  (qui recalculerait `interval`/`due`/`repetitions` à partir de `history` —
 *  hors de propos ici, cette suite teste la plomberie de stockage). */
function card(overrides: Partial<SrsCard> = {}): SrsCard {
  return {
    ease: 2.5,
    interval: 6,
    repetitions: 2,
    due: '2026-09-10',
    history: [],
    fsrs: {
      stability: 6,
      difficulty: 5,
      state: 2,
      reps: 2,
      lapses: 0,
      learningSteps: 0,
      lastReview: '2026-09-04',
      scheduledDays: 6,
    },
    ...overrides,
  };
}

function demoSong(id: string): Song {
  return {
    id,
    title: id,
    composer: '',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] }],
    contraponto: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
});

afterEach(() => {
  setAfterSave(() => {});
  vi.useRealTimers();
  // Filet de sécurité : un test de démo qui oublierait de nettoyer ne doit
  // jamais faire router les tests suivants vers `sessionStorage` (#109).
  stopDemo();
});

describe('saveProgress', () => {
  it('pose `_rev` à `Date.now()` et appelle le hook `afterSave`', () => {
    const hook = vi.fn();
    setAfterSave(hook);
    const progress = baseProgress({ _rev: 1 });
    saveProgress(progress);
    expect(progress._rev).toBe(Date.now());
    expect(hook).toHaveBeenCalledWith(progress);
  });

  it('persiste réellement dans `localStorage` (relecture via `loadProgress`)', () => {
    const progress = baseProgress({ cards: { x: card() } });
    saveProgress(progress);
    expect(loadProgress().cards.x).toEqual(card());
  });
});

describe('persistMerged', () => {
  it('écrit sans toucher `_rev` ni déclencher le hook `afterSave`', () => {
    const hook = vi.fn();
    setAfterSave(hook);
    const progress = baseProgress({ _rev: 42, cards: { x: card() } });
    persistMerged(progress);
    expect(progress._rev).toBe(42);
    expect(hook).not.toHaveBeenCalled();
    expect(loadProgress().cards.x).toEqual(card());
    expect(loadProgress()._rev).toBe(42);
  });
});

describe('helpers de mutation — mutent en place et persistent', () => {
  it('upsertSetlist ajoute puis remplace par id', () => {
    const progress = baseProgress();
    const setlist: Setlist = { id: 's1', name: 'Concert', songIds: ['a'], createdAt: '2026-01-01T00:00:00Z' };
    upsertSetlist(progress, setlist);
    expect(progress.setlists).toEqual([setlist]);
    expect(loadProgress().setlists).toEqual([setlist]);

    const renamed: Setlist = { ...setlist, name: 'Concert renommé' };
    upsertSetlist(progress, renamed);
    expect(progress.setlists).toEqual([renamed]);
  });

  it('deleteSetlist retire la setlist et neutralise `activeSetlistId` si c\'était elle', () => {
    const setlist: Setlist = { id: 's1', name: 'Concert', songIds: [], createdAt: '2026-01-01T00:00:00Z' };
    const progress = baseProgress({ setlists: [setlist], activeSetlistId: 's1' });
    deleteSetlist(progress, 's1');
    expect(progress.setlists).toEqual([]);
    expect(progress.activeSetlistId).toBeNull();
    expect(loadProgress().setlists).toEqual([]);
  });

  it('setActiveSetlist refuse un id qui ne correspond à aucune setlist', () => {
    const setlist: Setlist = { id: 's1', name: 'Concert', songIds: [], createdAt: '2026-01-01T00:00:00Z' };
    const progress = baseProgress({ setlists: [setlist] });
    setActiveSetlist(progress, 'inconnue');
    expect(progress.activeSetlistId).toBeNull();
    setActiveSetlist(progress, 's1');
    expect(progress.activeSetlistId).toBe('s1');
  });

  it('putCard écrit sous la clé `songId::instrumentId` et persiste', () => {
    const progress = baseProgress();
    putCard(progress, 'song-a', 'bb', card());
    expect(getCard(progress, 'song-a', 'bb')).toEqual(card());
    expect(loadProgress().cards[cardKey('song-a', 'bb')]).toEqual(card());
  });

  it('recordSession ajoute et plafonne l\'historique à 200, en ordre d\'ajout', () => {
    const progress = baseProgress();
    const run = (i: number): SessionRun => ({
      date: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      kind: 'deep',
      instrumentId: null,
      setlistId: null,
      setlistName: 'Tout le répertoire',
      songCount: 1,
    });
    for (let i = 0; i < 205; i += 1) recordSession(progress, run(i));
    expect(progress.sessions).toHaveLength(200);
    expect(progress.sessions[0]!.date).toBe(run(5).date);
    expect(progress.sessions.at(-1)!.date).toBe(run(204).date);
  });
});

describe('activeSetlist', () => {
  it('renvoie `null` sans `activeSetlistId`, et la setlist sinon', () => {
    const setlist: Setlist = { id: 's1', name: 'Concert', songIds: [], createdAt: '2026-01-01T00:00:00Z' };
    expect(activeSetlist(baseProgress({ setlists: [setlist] }))).toBeNull();
    expect(
      activeSetlist(baseProgress({ setlists: [setlist], activeSetlistId: 's1' })),
    ).toEqual(setlist);
  });
});

describe('mode démonstration (#109, outil de QA)', () => {
  it('seedDemoProgress construit un morceau par branche de `recommendedMode`', () => {
    const songs = ['nouveau', 'un-succes', 'deux-succes', 'trois-succes', 'again-recent'].map(
      demoSong,
    );
    seedDemoProgress(songs);
    expect(isDemoActive()).toBe(true);

    const progress = loadProgress();
    const modeOf = (id: string) => recommendedMode(getCard(progress, id, 'c'));
    expect(modeOf('nouveau')).toBe('entiere');
    expect(modeOf('un-succes')).toBe('entiere');
    expect(modeOf('deux-succes')).toBe('sans');
    expect(modeOf('trois-succes')).toBe('entiere');
    expect(modeOf('again-recent')).toBe('entiere');
  });

  it('ne touche jamais la vraie progression : `saveProgress` en démo laisse `localStorage` intact', () => {
    // Vraie progression, écrite avant toute démo.
    const real = baseProgress({ cards: { 'song-a::c': card() } });
    saveProgress(real);
    expect(loadProgress().cards['song-a::c']).toEqual(card());

    seedDemoProgress([demoSong('demo-song')]);
    // Une écriture pendant la démo (ex. un `finish()` de trainer) ne doit
    // apparaître que dans le stockage de démo.
    const demoProgress = loadProgress();
    demoProgress.cards['intrus'] = card();
    saveProgress(demoProgress);
    expect(loadProgress().cards['intrus']).toBeDefined();

    stopDemo();
    // La vraie progression n'a jamais bougé, et la démo ne persiste pas.
    const restored = loadProgress();
    expect(restored.cards['song-a::c']).toEqual(card());
    expect(restored.cards['intrus']).toBeUndefined();
  });

  it('`saveProgress` en démo ne déclenche jamais le hook de synchro', () => {
    const hook = vi.fn();
    setAfterSave(hook);
    seedDemoProgress([demoSong('demo-song')]);
    saveProgress(loadProgress());
    expect(hook).not.toHaveBeenCalled();
  });

  it('stopDemo efface le drapeau et les données de test', () => {
    seedDemoProgress([demoSong('demo-song')]);
    expect(isDemoActive()).toBe(true);
    stopDemo();
    expect(isDemoActive()).toBe(false);
    expect(loadProgress().cards).toEqual({});
  });
});
