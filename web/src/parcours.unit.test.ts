import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parcours, parcoursCase, PARCOURS_LONGUEUR } from './parcours';
import { review } from './srs';
import type { SrsCard, SrsReview, StudyMode } from './types';

const FIXED_TODAY = new Date(2026, 8, 23); // 2026-09-23, arbitraire

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

function entry(date: string, grade: number, mode?: StudyMode): SrsReview {
  return { date, grade, tempo: 'fluide', hints: 0, ...(mode ? { mode } : {}) };
}

function cardOf(history: SrsReview[]): SrsCard {
  return { ease: 2.5, interval: 6, repetitions: history.length, due: '2026-09-23', history };
}

describe('parcoursCase', () => {
  it('traduit chaque mode de présentation en case', () => {
    expect(parcoursCase(entry('2026-09-01', 4, 'entiere'))).toBe('partition');
    expect(parcoursCase(entry('2026-09-01', 4, 'mesures'))).toBe('partiel');
    expect(parcoursCase(entry('2026-09-01', 4, 'eclipses'))).toBe('partiel');
  });

  it('distingue le par cœur réussi du par cœur raté, au seuil de réussite', () => {
    expect(parcoursCase(entry('2026-09-01', 5, 'sans'))).toBe('par-coeur');
    expect(parcoursCase(entry('2026-09-01', 3, 'sans'))).toBe('par-coeur');
    expect(parcoursCase(entry('2026-09-01', 2, 'sans'))).toBe('par-coeur-rate');
    expect(parcoursCase(entry('2026-09-01', 0, 'sans'))).toBe('par-coeur-rate');
  });

  it("rend neutre une révision enregistrée avant le suivi du mode", () => {
    expect(parcoursCase(entry('2026-09-01', 4))).toBe('inconnu');
  });
});

describe('parcours', () => {
  it('est vide pour un morceau jamais travaillé', () => {
    expect(parcours([undefined, undefined])).toEqual([]);
    expect(parcours([cardOf([])])).toEqual([]);
  });

  it(`ne garde que les ${PARCOURS_LONGUEUR} dernières séances, les plus récentes à droite`, () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      entry(`2026-08-${String(i + 1).padStart(2, '0')}`, 4, i === 19 ? 'sans' : 'entiere'),
    );
    const cases = parcours([cardOf(history)]);
    expect(cases).toHaveLength(PARCOURS_LONGUEUR);
    expect(cases.at(-1)).toBe('par-coeur');
  });

  it('entrelace les transpositions par date', () => {
    const enUt = cardOf([entry('2026-09-01', 4, 'entiere'), entry('2026-09-05', 4, 'sans')]);
    const enSib = cardOf([entry('2026-09-03', 4, 'mesures')]);
    expect(parcours([enUt, enSib])).toEqual(['partition', 'partiel', 'par-coeur']);
  });

  it('mêle révisions anciennes (sans mode) et récentes', () => {
    const card = cardOf([entry('2026-09-01', 4), entry('2026-09-10', 1, 'sans')]);
    expect(parcours([card])).toEqual(['inconnu', 'par-coeur-rate']);
  });
});

describe('review() enregistre le mode', () => {
  it('conserve le mode dans la dernière entrée de l’historique', () => {
    const card = review(undefined, 4, 'fluide', 0, { mode: 'sans' });
    expect(card.history.at(-1)?.mode).toBe('sans');
    expect(parcours([card])).toEqual(['par-coeur']);
  });

  it("n'ajoute pas de mode quand l'appelant n'en donne pas (arpèges et gammes)", () => {
    const card = review(undefined, 4, 'fluide', 0, { bpm: 90 });
    expect(card.history.at(-1)).not.toHaveProperty('mode');
  });
});
