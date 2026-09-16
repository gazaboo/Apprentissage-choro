import { describe, expect, it } from 'vitest';
import { cycleOf } from './metronome';

describe('cycleOf', () => {
  it('renvoie null pendant le décompte de préparation (index négatif)', () => {
    expect(cycleOf(-4, 4)).toBeNull();
    expect(cycleOf(-1, 4)).toBeNull();
  });

  it('reste à la passe 0 pour toute la première traversée du motif', () => {
    for (let beat = 0; beat < 4; beat += 1) {
      expect(cycleOf(beat, 4)).toBe(0);
    }
  });

  it('avance d’une passe à chaque traversée complète du motif', () => {
    expect(cycleOf(4, 4)).toBe(1);
    expect(cycleOf(7, 4)).toBe(1);
    expect(cycleOf(8, 4)).toBe(2);
    expect(cycleOf(11, 4)).toBe(2);
    expect(cycleOf(12, 4)).toBe(3);
  });

  it('s’adapte à des motifs de longueurs différentes', () => {
    expect(cycleOf(6, 3)).toBe(2);
    expect(cycleOf(6, 7)).toBe(0);
    expect(cycleOf(13, 7)).toBe(1);
  });

  it('renvoie null si la longueur de motif est nulle ou négative', () => {
    expect(cycleOf(5, 0)).toBeNull();
    expect(cycleOf(5, -2)).toBeNull();
  });
});
