import { describe, expect, it } from 'vitest';
import { RATE_MAX, RATE_MIN, stepRate } from './audio';

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
