import { describe, expect, it } from 'vitest';
import { isValidCode, mergeProgress } from './sync';
import type { Progress } from './store';
import type { SrsCard } from './types';

function baseProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    sessions: [],
    _rev: 1,
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

function card(overrides: Partial<SrsCard> = {}): SrsCard {
  return {
    ease: 2.5,
    interval: 6,
    repetitions: 2,
    due: '2026-09-10',
    history: [],
    ...overrides,
  };
}

describe('isValidCode', () => {
  it('accepte lettres, chiffres, tiret et underscore, 3 à 64 caractères', () => {
    expect(isValidCode('abc')).toBe(true);
    expect(isValidCode('a1_B-2')).toBe(true);
    expect(isValidCode('a'.repeat(64))).toBe(true);
  });

  it('rejette trop court, trop long, ou des caractères hors motif', () => {
    expect(isValidCode('ab')).toBe(false);
    expect(isValidCode('a'.repeat(65))).toBe(false);
    expect(isValidCode('a b')).toBe(false);
    expect(isValidCode('a/b')).toBe(false);
  });
});

describe('mergeProgress — cartes', () => {
  it("garde la carte locale absente côté distant", () => {
    const local = baseProgress({ cards: { x: card() } });
    const merged = mergeProgress(local, {});
    expect(merged.cards.x).toEqual(card());
  });

  it("prend la carte distante absente localement", () => {
    const local = baseProgress();
    const remoteCard = card({ due: '2026-09-20' });
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x).toEqual(remoteCard);
  });

  it('entre deux cartes présentes des deux côtés, la plus récemment révisée gagne (via history)', () => {
    const local = baseProgress({
      cards: {
        x: card({
          due: '2026-09-01',
          history: [{ date: '2026-08-01', grade: 4, tempo: 'fluide', hints: 0 }],
        }),
      },
    });
    const remoteCard = card({
      due: '2026-09-05',
      history: [{ date: '2026-08-10', grade: 5, tempo: 'fluide', hints: 0 }],
    });
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x).toEqual(remoteCard);
  });

  it('repli sur `due` quand `history` est vide des deux côtés', () => {
    const local = baseProgress({ cards: { x: card({ due: '2026-09-01', history: [] }) } });
    const remoteCard = card({ due: '2026-09-10', history: [] });
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    // La date distante (due) est postérieure à la locale : elle l'emporte.
    expect(merged.cards.x).toEqual(remoteCard);
  });

  it('à date de dernière révision égale, la carte avec le plus long historique gagne', () => {
    const local = baseProgress({
      cards: {
        x: card({
          due: '2026-09-01',
          history: [{ date: '2026-08-15', grade: 4, tempo: 'fluide', hints: 0 }],
        }),
      },
    });
    const remoteCard = card({
      due: '2026-09-01',
      history: [
        { date: '2026-08-01', grade: 3, tempo: 'crispe', hints: 2 },
        { date: '2026-08-15', grade: 5, tempo: 'fluide', hints: 0 },
      ],
    });
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x).toEqual(remoteCard);
  });

  it('une carte distante malformée est ignorée sans jeter, la locale est conservée', () => {
    const local = baseProgress({ cards: { x: card() } });
    const merged = mergeProgress(local, {
      cards: { x: { ease: 'pas-un-nombre' }, y: null },
    });
    expect(merged.cards.x).toEqual(card());
    expect(merged.cards.y).toBeUndefined();
  });

  it("l'état FSRS d'une carte distante survit à la fusion (non-régression de `normalizeCard`)", () => {
    const fsrs = {
      stability: 8.3,
      difficulty: 2.1,
      state: 2 as const,
      reps: 3,
      lapses: 0,
      learningSteps: 0,
      lastReview: '2026-09-08',
      scheduledDays: 10,
    };
    const local = baseProgress();
    const remoteCard = card({ due: '2026-09-20', fsrs });
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x!.fsrs).toEqual(fsrs);
  });

  it('un `fsrs` distant de forme invalide est omis plutôt que propagé', () => {
    const local = baseProgress();
    const remoteCard = { ...card({ due: '2026-09-20' }), fsrs: { stability: 'pas-un-nombre' } };
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x!.fsrs).toBeUndefined();
  });

  it('une carte distante sans `fsrs` (appareil non migré) est acceptée telle quelle', () => {
    const local = baseProgress();
    const remoteCard = card({ due: '2026-09-20' }); // pas de champ `fsrs`
    const merged = mergeProgress(local, { cards: { x: remoteCard } });
    expect(merged.cards.x!.fsrs).toBeUndefined();
    expect(merged.cards.x).toEqual(remoteCard);
  });
});

describe('mergeProgress — sessions', () => {
  it('union les séances locales et distantes, triées par date, sans doublon', () => {
    const local = baseProgress({
      sessions: [
        { date: '2026-09-01T10:00:00Z', kind: 'deep', instrumentId: null, setlistId: null, setlistName: 'Tout le répertoire', songCount: 3 },
      ],
    });
    const remote: Partial<Progress> = {
      sessions: [
        { date: '2026-09-01T10:00:00Z', kind: 'deep', instrumentId: null, setlistId: null, setlistName: 'Tout le répertoire', songCount: 3 },
        { date: '2026-08-01T09:00:00Z', kind: 'urgent', instrumentId: 'bb', setlistId: null, setlistName: 'Tout le répertoire', songCount: 3 },
      ],
    };
    const merged = mergeProgress(local, remote);
    expect(merged.sessions.map((s) => s.date)).toEqual([
      '2026-08-01T09:00:00Z',
      '2026-09-01T10:00:00Z',
    ]);
  });

  it('plafonne à 200 séances en gardant les plus récentes', () => {
    const local = baseProgress({
      sessions: Array.from({ length: 150 }, (_, i) => ({
        date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}Z`,
        kind: 'deep' as const,
        instrumentId: null,
        setlistId: null,
        setlistName: 'Tout le répertoire',
        songCount: 1,
      })),
    });
    const remote: Partial<Progress> = {
      sessions: Array.from({ length: 100 }, (_, i) => ({
        date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i).padStart(2, '0')}Z`,
        kind: 'deep' as const,
        instrumentId: null,
        setlistId: null,
        setlistName: 'Tout le répertoire',
        songCount: 1,
      })),
    };
    const merged = mergeProgress(local, remote);
    expect(merged.sessions).toHaveLength(200);
    // Toutes les séances de février (plus récentes) sont conservées ; parmi les
    // 150 de janvier, seules les 100 chronologiquement les plus tardives le sont.
    const janKept = merged.sessions.filter((s) => s.date.startsWith('2026-01')).length;
    const febKept = merged.sessions.filter((s) => s.date.startsWith('2026-02')).length;
    expect(janKept).toBe(100);
    expect(febKept).toBe(100);
  });
});

describe('mergeProgress — réglages et setlists', () => {
  const remoteSetlists: Progress['setlists'] = [
    { id: 's1', name: 'Concert', songIds: ['a', 'b'], createdAt: '2026-09-01T00:00:00Z' },
  ];
  const remoteSettings: Progress['settings'] = {
    blockMinutes: 10,
    display: 'grille',
    studyMode: 'sans',
    maskLevel: 75,
    maskSeed: 9,
    eclipseIntensity: 'intenses',
    instrumentDefault: 'bb',
    contrechant: 'sans',
    panel: null,
    fullpage: { zoom: 1.5, twoColumns: false, playerHidden: true },
  };

  it('prend le bloc distant si son `_rev` est plus haut ET setlists/settings bien formés', () => {
    const local = baseProgress({ _rev: 1 });
    const merged = mergeProgress(local, {
      _rev: 2,
      setlists: remoteSetlists,
      settings: remoteSettings,
    });
    expect(merged.setlists).toEqual(remoteSetlists);
    expect(merged.settings).toEqual(remoteSettings);
    expect(merged._rev).toBe(2);
  });

  it('garde le bloc local si `_rev` distant est plus bas, même avec des setlists distantes', () => {
    const local = baseProgress({ _rev: 5, setlists: [] });
    const merged = mergeProgress(local, {
      _rev: 2,
      setlists: remoteSetlists,
      settings: remoteSettings,
    });
    expect(merged.setlists).toEqual([]);
    expect(merged._rev).toBe(5);
  });

  it('garde le bloc local si `_rev` distant est plus haut mais `setlists` absent (pas un array)', () => {
    const local = baseProgress({ _rev: 1, setlists: [] });
    const merged = mergeProgress(local, { _rev: 9, settings: remoteSettings });
    expect(merged.setlists).toEqual([]);
    // `_rev` reste le max des deux même si le bloc n'est pas repris.
    expect(merged._rev).toBe(9);
  });

  it('garde le bloc local si `_rev` distant est plus haut mais `settings` absent (pas un objet)', () => {
    const local = baseProgress({ _rev: 1 });
    const merged = mergeProgress(local, { _rev: 9, setlists: remoteSetlists });
    expect(merged.setlists).toEqual([]);
    expect(merged.settings).toEqual(local.settings);
  });

  it('`_rev` du résultat est le max des deux `_rev`', () => {
    const local = baseProgress({ _rev: 42 });
    const merged = mergeProgress(local, { _rev: 7 });
    expect(merged._rev).toBe(42);
  });

  it('neutralise `activeSetlistId` s\'il pointe une setlist absente après fusion', () => {
    const local = baseProgress({ _rev: 1, activeSetlistId: 'ghost', setlists: [] });
    const merged = mergeProgress(local, {
      _rev: 5,
      setlists: remoteSetlists,
      settings: remoteSettings,
      activeSetlistId: 'ghost',
    });
    expect(merged.activeSetlistId).toBeNull();
  });
});

describe('mergeProgress — `remoteRaw` dégénéré', () => {
  it('traite `null` comme `{}`', () => {
    const local = baseProgress({ cards: { x: card() } });
    const merged = mergeProgress(local, null);
    expect(merged.cards).toEqual({ x: card() });
    expect(merged.sessions).toEqual([]);
  });

  it('traite une chaîne comme `{}`', () => {
    const local = baseProgress({ cards: { x: card() } });
    const merged = mergeProgress(local, 'pas-un-objet');
    expect(merged.cards).toEqual({ x: card() });
  });
});
