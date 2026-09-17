import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRotation, formatCountdown, pickSessionItems } from './session';
import type { Progress } from './store';
import type { Song } from './types';

function song(id: string, instruments: Song['instruments'] = [{ id: 'c', name: 'Ut', page_count: 1, measure_count: 1, pages: [] }]): Song {
  return {
    id,
    title: id,
    composer: '',
    audio: { reference: null, playback: null },
    instruments,
    contraponto: null,
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
      instrumentDefault: 'c',
      contrechant: 'sans',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
    },
    ...overrides,
  };
}

describe('formatCountdown', () => {
  it('formate minutes:secondes avec zéro de tête', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(600)).toBe('10:00');
  });
});

describe('buildRotation', () => {
  it('deux morceaux → deux tours entrelacés (A,B,A,B)', () => {
    const items = [
      { song: song('a'), instrumentId: 'c' as const },
      { song: song('b'), instrumentId: 'c' as const },
    ];
    const blocks = buildRotation(items);
    expect(blocks.map((b) => b.item.song.id)).toEqual(['a', 'b', 'a', 'b']);
    expect(blocks.map((b) => b.index)).toEqual([1, 2, 3, 4]);
  });

  it('trois morceaux → deux tours de trois (6 blocs)', () => {
    const items = [
      { song: song('a'), instrumentId: 'c' as const },
      { song: song('b'), instrumentId: 'c' as const },
      { song: song('c'), instrumentId: 'c' as const },
    ];
    const blocks = buildRotation(items);
    expect(blocks.map((b) => b.item.song.id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});

describe('pickSessionItems', () => {
  beforeEach(() => {
    // Neutralise le départage aléatoire pour rendre le tri déterministe.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exclut les morceaux sans instrument', () => {
    const songs = [song('a', []), song('b')];
    const items = pickSessionItems(songs, baseProgress(), 2);
    expect(items.map((i) => i.song.id)).toEqual(['b']);
  });

  it('priorise les morceaux jamais travaillés (retard infini), puis les plus en retard', () => {
    const progress = baseProgress({
      cards: {
        'recent::c': { ease: 2.5, interval: 30, repetitions: 3, due: '2099-01-01', history: [] },
        'late::c': { ease: 2.5, interval: 1, repetitions: 1, due: '2000-01-01', history: [] },
      },
    });
    const songs = [song('recent'), song('late'), song('never')];
    const items = pickSessionItems(songs, progress, 2);
    // "never" (jamais travaillé) et "late" (le plus en retard) passent devant "recent".
    expect(items.map((i) => i.song.id).sort()).toEqual(['late', 'never'].sort());
  });

  it('`count` est borné entre 1 et le nombre de morceaux disponibles', () => {
    const songs = [song('a'), song('b')];
    expect(pickSessionItems(songs, baseProgress(), 0)).toHaveLength(1);
    expect(pickSessionItems(songs, baseProgress(), 10)).toHaveLength(2);
  });
});

describe('pickSessionItems — ordre aléatoire à égalité de retard (#82)', () => {
  // Tous jamais travaillés : même retard (+Infinity) pour les cinq.
  const songs = ['a', 'b', 'c', 'd', 'e'].map((id) => song(id));

  it('une graine fixe donne un ordre déterministe et reproductible', () => {
    const rng = () => 0.42; // constante : reproductible d'un appel à l'autre.
    const first = pickSessionItems(songs, baseProgress(), songs.length, rng).map((i) => i.song.id);
    const second = pickSessionItems(songs, baseProgress(), songs.length, () => 0.42).map(
      (i) => i.song.id,
    );
    expect(first).toEqual(second);
  });

  it('deux séquences de rng différentes donnent des ordres différents', () => {
    let call = 0;
    const sequence = [0.1, 0.9, 0.2, 0.8, 0.3];
    const rngA = () => sequence[call++ % sequence.length]!;
    let callB = 0;
    const reversed = [...sequence].reverse();
    const rngB = () => reversed[callB++ % reversed.length]!;

    const orderA = pickSessionItems(songs, baseProgress(), songs.length, rngA).map(
      (i) => i.song.id,
    );
    const orderB = pickSessionItems(songs, baseProgress(), songs.length, rngB).map(
      (i) => i.song.id,
    );
    expect(orderA).not.toEqual(orderB);
    // Même ensemble malgré l'ordre différent : rien n'est perdu ni dupliqué.
    expect([...orderA].sort()).toEqual([...orderB].sort());
  });

  it("le tirage aléatoire ne mélange pas des morceaux de retard différent", () => {
    const progress = baseProgress({
      cards: {
        'b::c': { ease: 2.5, interval: 1, repetitions: 1, due: '2000-01-01', history: [] },
      },
    });
    const withRetard = ['a', 'b', 'c'].map((id) => song(id));
    // "b" a une carte en retard (retard fini) ; "a" et "c" sont jamais
    // travaillés (retard infini) : "b" doit toujours arriver en dernier,
    // quel que soit le tirage sur le groupe { a, c }.
    for (const value of [0.01, 0.5, 0.99]) {
      const order = pickSessionItems(withRetard, progress, 3, () => value).map(
        (i) => i.song.id,
      );
      expect(order[2]).toBe('b');
      expect(new Set(order.slice(0, 2))).toEqual(new Set(['a', 'c']));
    }
  });
});
