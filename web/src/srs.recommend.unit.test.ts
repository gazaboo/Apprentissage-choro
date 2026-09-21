import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recommendedMode } from './srs';
import type { SrsCard, SrsReview } from './types';

const FIXED_TODAY = new Date(2026, 8, 21); // 2026-09-21, arbitraire

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fixture d'historique : chaque note passée devient une entrée datée. */
function historyOf(grades: number[]): SrsReview[] {
  return grades.map((grade, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    grade,
    tempo: 'fluide',
    hints: 0,
  }));
}

function cardWith(grades: number[]): SrsCard {
  return {
    ease: 2.5,
    interval: 6,
    repetitions: grades.length,
    due: '2026-09-21',
    history: historyOf(grades),
    fsrs: undefined,
  };
}

describe('recommendedMode', () => {
  it('« Partition entière » pour un morceau nouveau (pas de carte, ou historique vide)', () => {
    expect(recommendedMode(undefined)).toBe('entiere');
    expect(recommendedMode(cardWith([]))).toBe('entiere');
  });

  it('« Partition entière » si la dernière révision est un Again récent (grade < 3), même après un bon palier', () => {
    expect(recommendedMode(cardWith([5, 5, 5, 2]))).toBe('entiere');
  });

  it('« Partition entière » tant que moins de deux révisions Good/Easy (grade >= 4) ont été enregistrées', () => {
    expect(recommendedMode(cardWith([5]))).toBe('entiere');
    expect(recommendedMode(cardWith([3, 3, 3]))).toBe('entiere'); // Hard répété, jamais Good/Easy
    expect(recommendedMode(cardWith([5, 3]))).toBe('entiere'); // un seul Good/Easy
  });

  it('une fois le palier des deux Good/Easy atteint, alterne une révision sur deux', () => {
    expect(recommendedMode(cardWith([5, 5]))).toBe('sans'); // 2 révisions, paire
    expect(recommendedMode(cardWith([5, 5, 5]))).toBe('entiere'); // 3, impaire
    expect(recommendedMode(cardWith([5, 5, 5, 5]))).toBe('sans'); // 4, paire
    expect(recommendedMode(cardWith([5, 5, 5, 5, 5]))).toBe('entiere'); // 5, impaire
  });

  it('un vieil échec qui n\'est pas la dernière révision ne bloque pas l\'alternance', () => {
    expect(recommendedMode(cardWith([5, 2, 5, 5]))).toBe('sans'); // 4 révisions, dernière = 5
  });

  it('fonctionne sur une carte héritée sans champ `fsrs`', () => {
    const legacy: SrsCard = {
      ease: 2.5,
      interval: 6,
      repetitions: 2,
      due: '2026-09-21',
      history: historyOf([5, 5]),
    };
    expect(recommendedMode(legacy)).toBe('sans');
  });
});
