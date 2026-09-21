import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysOverdue,
  isoDate,
  masteryLevel,
  newCard,
  review,
  statusOf,
  suggestGrade,
} from './srs';
import type { SrsCard } from './types';

const FIXED_TODAY = new Date(2026, 8, 14); // 2026-09-14, un lundi arbitraire

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Avance l'horloge simulée : une révision réaliste arrive à échéance, pas
 *  le jour même (FSRS traite les révisions same-day à part). */
function advance(days: number): void {
  vi.setSystemTime(new Date(Date.now() + days * 86_400_000));
}

describe('isoDate / addDays', () => {
  it('formate en AAAA-MM-JJ avec zéros de tête', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('addDays avance les jours et bascule le mois/l\'année si besoin', () => {
    expect(isoDate(addDays(new Date(2026, 0, 30), 3))).toBe('2026-02-02');
    expect(isoDate(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
  });
});

describe('newCard', () => {
  it('démarre avec une aisance neutre, aucune répétition, échue aujourd\'hui', () => {
    const card = newCard();
    expect(card).toMatchObject({
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      due: '2026-09-14',
      history: [],
    });
    // L'état FSRS lui-même est vérifié dans `srs.fsrs.unit.test.ts`.
    expect(card.fsrs).toBeDefined();
  });
});

describe('review', () => {
  it('note clampée entre 0 et 5 (arrondie)', () => {
    const failing = review(undefined, -3, 'fluide', 0);
    const passing = review(undefined, 42, 'fluide', 0);
    expect(failing.history.at(-1)!.grade).toBe(0);
    expect(passing.history.at(-1)!.grade).toBe(5);
  });

  it('`hints` et `mesures` sont tracés dans `history` sans influencer le calcul d\'intervalle', () => {
    const card = review(undefined, 4, 'fluide', 0);
    const withoutMesures = review(card, 4, 'fluide', 2);
    const withMesures = review(card, 4, 'fluide', 2, { bpm: 120, justesse: 0.9, placement: 0.8 });
    expect(withoutMesures.interval).toBe(withMesures.interval);
    expect(withoutMesures.fsrs).toEqual(withMesures.fsrs);
    expect(withMesures.history.at(-1)).toMatchObject({ bpm: 120, justesse: 0.9, placement: 0.8, hints: 2 });
  });
});

describe('daysOverdue', () => {
  it('renvoie +Infinity pour une carte jamais travaillée', () => {
    expect(daysOverdue(undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it('0 le jour même, positif en retard, négatif si pas encore due', () => {
    const dueToday: SrsCard = { ease: 2.5, interval: 1, repetitions: 1, due: '2026-09-14', history: [] };
    const overdue: SrsCard = { ease: 2.5, interval: 1, repetitions: 1, due: '2026-09-10', history: [] };
    const future: SrsCard = { ease: 2.5, interval: 1, repetitions: 1, due: '2026-09-20', history: [] };
    expect(daysOverdue(dueToday)).toBe(0);
    expect(daysOverdue(overdue)).toBe(4);
    expect(daysOverdue(future)).toBe(-6);
  });
});

describe('statusOf', () => {
  it('"jamais" si la carte est absente ou sans historique', () => {
    expect(statusOf(undefined)).toBe('jamais');
    expect(statusOf({ ease: 2.5, interval: 0, repetitions: 0, due: '2026-09-14', history: [] })).toBe('jamais');
  });

  it('"a-reviser" si due aujourd\'hui ou en retard, avec un historique', () => {
    const card: SrsCard = {
      ease: 2.5,
      interval: 1,
      repetitions: 1,
      due: '2026-09-10',
      history: [{ date: '2026-09-09', grade: 4, tempo: 'fluide', hints: 0 }],
    };
    expect(statusOf(card)).toBe('a-reviser');
  });

  it('"a-jour" si pas encore due, même après un échec récent', () => {
    const card: SrsCard = {
      ease: 1.3,
      interval: 1,
      repetitions: 0,
      due: '2026-09-20',
      history: [{ date: '2026-09-13', grade: 1, tempo: 'crispe', hints: 5 }],
    };
    expect(statusOf(card)).toBe('a-jour');
  });
});

describe('masteryLevel', () => {
  it('0 si la carte est absente ou sans historique', () => {
    expect(masteryLevel(undefined)).toBe(0);
    expect(masteryLevel({ ease: 2.5, interval: 0, repetitions: 0, due: '2026-09-14', history: [] })).toBe(0);
  });

  it('monte de façon non décroissante sur des réussites espacées, jusqu\'au niveau maximal', () => {
    let card: SrsCard | undefined = undefined;
    let previous = 0;
    for (let i = 0; i < 6; i += 1) {
      if (card) advance(Math.max(1, card.interval));
      card = review(card, 4, 'fluide', 0);
      const level = masteryLevel(card);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(previous).toBe(5);
  });

  it('des notes parfaites (Easy) font monter la jauge au moins aussi vite que des notes correctes (Good)', () => {
    // Les deux cartes sont révisées aux mêmes instants (l'horloge n'avance
    // qu'une fois par tour) : seule la note diffère, ce qui isole son effet.
    let good: SrsCard | undefined = undefined;
    let easy: SrsCard | undefined = undefined;
    for (let i = 0; i < 5; i += 1) {
      if (good) advance(Math.max(1, good.interval));
      good = review(good, 4, 'fluide', 0);
      easy = review(easy, 5, 'fluide', 0);
      expect(masteryLevel(easy)).toBeGreaterThanOrEqual(masteryLevel(good));
    }
  });

  it('un échec après plusieurs réussites ne retombe jamais à 0 et ne dépasse jamais le niveau qui précédait', () => {
    let card: SrsCard | undefined = undefined;
    for (let i = 0; i < 4; i += 1) {
      if (card) advance(Math.max(1, card.interval));
      card = review(card, 5, 'fluide', 0);
    }
    const before = masteryLevel(card);
    expect(before).toBeGreaterThan(1);
    const afterFailure = review(card, 1, 'fluide', 3);
    const after = masteryLevel(afterFailure);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe('suggestGrade', () => {
  it('4 par défaut quand rien n\'était masqué', () => {
    expect(suggestGrade(0, 0)).toBe(4);
  });

  it('suit la table ratio indices/masquées : 0 → 5, ≤0.15 → 4, ≤0.35 → 3, ≤0.6 → 2, sinon 1', () => {
    expect(suggestGrade(0, 10)).toBe(5);
    expect(suggestGrade(1, 10)).toBe(4); // 0.10
    expect(suggestGrade(3, 10)).toBe(3); // 0.30
    expect(suggestGrade(5, 10)).toBe(2); // 0.50
    expect(suggestGrade(8, 10)).toBe(1); // 0.80
  });
});
