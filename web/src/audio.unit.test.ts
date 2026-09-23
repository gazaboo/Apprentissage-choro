import { describe, expect, it } from 'vitest';
import { RATE_MAX, RATE_MIN, stepBpm, stepRate } from './audio';

describe('stepRate', () => {
  it('descend d’un cran de 0,05', () => {
    expect(stepRate(1, -1)).toBe(0.95);
  });

  it('remonte d’un cran de 0,05', () => {
    expect(stepRate(0.95, 1)).toBe(1);
  });

  it('ne dérive pas en flottant sur des appuis répétés', () => {
    // 1 → 0.5 en 10 pas de -0.05 : sans arrondi, la somme flottante dérive
    // (0.5000000000000001) et ne compare plus jamais égale à RATE_MIN.
    let rate = 1;
    for (let i = 0; i < 10; i++) rate = stepRate(rate, -1);
    expect(rate).toBe(0.5);
  });

  it('reste au plancher RATE_MIN une fois atteint', () => {
    expect(stepRate(RATE_MIN, -1)).toBe(RATE_MIN);
  });

  it('reste au plafond RATE_MAX (pas d’accéléré au-delà de 1×)', () => {
    expect(stepRate(RATE_MAX, 1)).toBe(RATE_MAX);
  });
});

describe('stepBpm', () => {
  it('descend d’un cran de 5 BPM à partir du tempo original', () => {
    expect(stepBpm(RATE_MAX, 120, -1)).toBe(115 / 120);
  });

  it('rejoint exactement RATE_MAX en remontant, sans dérive flottante', () => {
    const slower = stepBpm(RATE_MAX, 120, -1);
    expect(stepBpm(slower, 120, 1)).toBe(RATE_MAX);
  });

  it('reste au plancher RATE_MIN une fois atteint', () => {
    expect(stepBpm(RATE_MIN, 120, -1)).toBe(RATE_MIN);
  });

  it('reste au plafond RATE_MAX une fois atteint', () => {
    expect(stepBpm(RATE_MAX, 120, 1)).toBe(RATE_MAX);
  });

  it('décale d’un pas rond même sur un tempo mesuré non entier', () => {
    // `detect_bpm()` (librosa) renvoie un flottant, ex. 119.8 — pas 120 pile.
    const originalBpm = 119.8;
    const rate = stepBpm(RATE_MAX, originalBpm, -1);
    expect(Math.round(rate * originalBpm)).toBe(115);
  });

  it('rejoint exactement RATE_MAX sur un tempo non entier, sans dérive flottante', () => {
    const originalBpm = 119.8;
    const slower = stepBpm(RATE_MAX, originalBpm, -1);
    expect(stepBpm(slower, originalBpm, 1)).toBe(RATE_MAX);
  });
});
