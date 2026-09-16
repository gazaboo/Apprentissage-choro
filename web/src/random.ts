/** Générateur pseudo-aléatoire déterministe, partagé par les vues à trous.
 *
 * Le motif de masquage doit être stable d'une session à l'autre : on veut
 * réviser les mêmes trous, pas redécouvrir une page différente à chaque
 * chargement. Le bouton « Mélanger » fait avancer la graine, seule façon
 * d'obtenir un nouveau tirage.
 */

/** mulberry32, amorcé par le hachage de la graine. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mélange en place, par groupes d'éléments consécutifs de même clé, sans
 * changer l'ordre des groupes entre eux — le tableau doit déjà être trié par
 * `keyOf`. Sert à départager équitablement des ex-æquo (ex. même retard SRS)
 * sans perturber le tri global qui les précède.
 */
export function shuffleTies<T>(
  items: T[],
  keyOf: (item: T) => unknown,
  rng: () => number = Math.random,
): T[] {
  let start = 0;
  for (let i = 1; i <= items.length; i += 1) {
    if (i === items.length || keyOf(items[i]!) !== keyOf(items[start]!)) {
      // Fisher-Yates sur la tranche [start, i).
      for (let k = i - 1; k > start; k -= 1) {
        const j = start + Math.floor(rng() * (k - start + 1));
        [items[k], items[j]] = [items[j]!, items[k]!];
      }
      start = i;
    }
  }
  return items;
}
