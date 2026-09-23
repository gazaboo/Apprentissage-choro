import { describe, expect, it } from 'vitest';
import { shuffleTies } from './random';

describe('shuffleTies', () => {
  it('ne touche pas un tableau vide ou à un seul élément', () => {
    expect(shuffleTies([], () => 0, () => 0.5)).toEqual([]);
    expect(shuffleTies([1], () => 0, () => 0.5)).toEqual([1]);
  });

  it("ne mélange pas des éléments de clés différentes entre eux", () => {
    // Trois groupes distincts (clé décroissante) : peu importe le rng, un
    // élément du groupe 2 ne doit jamais se retrouver en position du groupe 1.
    const items = [
      { k: 2, v: 'a' },
      { k: 2, v: 'b' },
      { k: 1, v: 'c' },
      { k: 1, v: 'd' },
      { k: 1, v: 'e' },
      { k: 0, v: 'f' },
    ];
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      const result = shuffleTies([...items], (item) => item.k, () => value);
      expect(result.map((r) => r.k)).toEqual([2, 2, 1, 1, 1, 0]);
      expect(new Set(result.slice(0, 2).map((r) => r.v))).toEqual(new Set(['a', 'b']));
      expect(new Set(result.slice(2, 5).map((r) => r.v))).toEqual(new Set(['c', 'd', 'e']));
      expect(result[5]!.v).toBe('f');
    }
  });

  it('une graine (rng) fixe donne un résultat déterministe et reproductible', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((v) => ({ k: 0, v }));
    let call = 0;
    const seq = [0.9, 0.1, 0.6, 0.3];
    const rng = () => seq[call++ % seq.length]!;

    call = 0;
    const first = shuffleTies([...items], (i) => i.k, rng).map((i) => i.v);
    call = 0;
    const second = shuffleTies([...items], (i) => i.k, rng).map((i) => i.v);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('des séquences de rng différentes donnent des ordres différents', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((v) => ({ k: 0, v }));
    let callA = 0;
    const seqA = [0.1, 0.9, 0.2, 0.8];
    const rngA = () => seqA[callA++ % seqA.length]!;
    let callB = 0;
    const seqB = [...seqA].reverse();
    const rngB = () => seqB[callB++ % seqB.length]!;

    const a = shuffleTies([...items], (i) => i.k, rngA).map((i) => i.v);
    const b = shuffleTies([...items], (i) => i.k, rngB).map((i) => i.v);
    expect(a).not.toEqual(b);
  });

  it('sans rng fourni, utilise `Math.random` (reste une permutation valide)', () => {
    const items = ['a', 'b', 'c', 'd'].map((v) => ({ k: 0, v }));
    const result = shuffleTies([...items], (i) => i.k).map((i) => i.v);
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
