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
    expect(card).toEqual({
      ease: 2.5,
      interval: 0,
      repetitions: 0,
      due: '2026-09-14',
      history: [],
    });
  });
});

describe('review', () => {
  it('note clampée entre 0 et 5 (arrondie)', () => {
    const failing = review(undefined, -3, 'fluide', 0);
    const passing = review(undefined, 42, 'fluide', 0);
    expect(failing.history.at(-1)!.grade).toBe(0);
    expect(passing.history.at(-1)!.grade).toBe(5);
  });

  it('un échec (note < 3) repart de zéro : repetitions=0, intervalle=1 jour', () => {
    const card: SrsCard = { ease: 2.5, interval: 30, repetitions: 4, due: '2026-09-01', history: [] };
    const result = review(card, 1, 'fluide', 3);
    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
    expect(result.due).toBe('2026-09-15');
  });

  it('progression d\'intervalle sur réussites successives : rep1=1j, rep2=6j, rep3=arrondi(interval*ease)', () => {
    let card: SrsCard | undefined = undefined;
    card = review(card, 5, 'fluide', 0);
    expect(card.repetitions).toBe(1);
    expect(card.interval).toBe(1);

    card = review(card, 5, 'fluide', 0);
    expect(card.repetitions).toBe(2);
    expect(card.interval).toBe(6);

    const easeBeforeThird = card.ease;
    card = review(card, 5, 'fluide', 0);
    expect(card.repetitions).toBe(3);
    expect(card.interval).toBe(Math.round(6 * easeBeforeThird));
  });

  it('le plancher d\'ease (1.3) n\'est jamais franchi même après des notes basses répétées', () => {
    let card: SrsCard | undefined = undefined;
    for (let i = 0; i < 10; i += 1) {
      card = review(card, 0, 'fluide', 0);
    }
    expect(card!.ease).toBeCloseTo(1.3, 5);
  });

  it('le facteur tempo réduit l\'intervalle (sous-tempo < crispé < fluide) sans jamais tomber sous 1 jour', () => {
    const card: SrsCard = { ease: 2.5, interval: 1, repetitions: 2, due: '2026-09-01', history: [] };
    const sousTempo = review(card, 5, 'sous-tempo', 0);
    const crispe = review(card, 5, 'crispe', 0);
    const fluide = review(card, 5, 'fluide', 0);
    expect(sousTempo.interval).toBeLessThanOrEqual(crispe.interval);
    expect(crispe.interval).toBeLessThanOrEqual(fluide.interval);
    expect(sousTempo.interval).toBeGreaterThanOrEqual(1);
  });

  it('`hints` et `mesures` sont tracés dans `history` sans influencer le calcul d\'intervalle', () => {
    const card: SrsCard = { ease: 2.5, interval: 6, repetitions: 2, due: '2026-09-01', history: [] };
    const withoutMesures = review(card, 4, 'fluide', 2);
    const withMesures = review(card, 4, 'fluide', 2, { bpm: 120, justesse: 0.9, placement: 0.8 });
    expect(withoutMesures.interval).toBe(withMesures.interval);
    expect(withoutMesures.ease).toBe(withMesures.ease);
    expect(withMesures.history.at(-1)).toMatchObject({ bpm: 120, justesse: 0.9, placement: 0.8, hints: 2 });
  });

  it('`history` est plafonné à 50 entrées, les plus anciennes tombent en premier', () => {
    let card: SrsCard = { ease: 2.5, interval: 1, repetitions: 0, due: '2026-09-01', history: [] };
    for (let i = 0; i < 60; i += 1) {
      card = review(card, 5, 'fluide', 0);
    }
    expect(card.history).toHaveLength(50);
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

  it('"a-jour" si pas encore due, même si `repetitions` a été remis à zéro par un échec récent', () => {
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

  it('monte de 1 à 5 sur des réussites successives (note 4, ease constant à 2.5)', () => {
    // Note 4 laisse `ease` inchangé (delta nul dans la formule SM-2), donc
    // l'intervalle suit exactement 1, 6, 15, 38, 95 — un cas propre pour
    // vérifier les seuils sans dérive d'`ease`.
    let card: SrsCard | undefined = undefined;
    const levels: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      card = review(card, 4, 'fluide', 0);
      levels.push(masteryLevel(card));
    }
    expect(levels).toEqual([1, 2, 3, 4, 5]);
  });

  it('monte plus vite avec des notes parfaites (ease croît à chaque révision)', () => {
    let card: SrsCard | undefined = undefined;
    const levels: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      card = review(card, 5, 'fluide', 0);
      levels.push(masteryLevel(card));
    }
    expect(levels).toEqual([1, 2, 4, 5, 5]);
  });

  it('un échec après plusieurs réussites retombe à 1, jamais à 0', () => {
    let card: SrsCard | undefined = undefined;
    for (let i = 0; i < 4; i += 1) {
      card = review(card, 5, 'fluide', 0);
    }
    expect(masteryLevel(card)).toBeGreaterThan(1);
    const afterFailure = review(card, 1, 'fluide', 3);
    expect(afterFailure.interval).toBe(1);
    expect(masteryLevel(afterFailure)).toBe(1);
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
