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
