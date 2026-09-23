/** Latence aller-retour haut-parleur → micro, mesurée sur les clics du décompte.
 *
 * Les battues sont datées à l'instant où le clic est *programmé* ; les attaques
 * à l'instant où le micro les *reçoit*. Entre les deux : la sortie audio, l'air,
 * l'entrée audio. Mesuré sur des prises réelles, ~85 ms — qu'on joue pile sur
 * le clic entendu, et chaque note paraît en retard d'autant.
 *
 * Plutôt que de faire calibrer chaque appareil, on écoute le décompte : ses
 * quatre clics (600 Hz, un timbre à part) sortent du haut-parleur et le micro
 * les entend. L'écart entre l'instant programmé et l'instant reçu est
 * exactement la latence à retirer — mesurée à chaque évaluation, sur ce
 * matériel-là, sans rien demander. Au casque, le micro n'entend rien : on se
 * rabat sur l'estimation du navigateur (`latenceEstimee`).
 *
 * Le jeu du musicien n'entre jamais dans la mesure : elle ne regarde que des
 * clics, d'une régularité de machine, pour que l'écart propre du musicien
 * reste ce que l'évaluation juge.
 */

/** Fréquence du clic de décompte (`metronome.ts`). */
export const FREQUENCE_DECOMPTE = 600;

/** Au-delà, on considère qu'aucun clic n'a été entendu (casque, micro coupé). */
const LATENCE_MAX_S = 0.4;
/** Analyse glissante : fenêtre ~5 ms, pas ~1,3 ms. */
const FENETRE = 256;
const PAS = 64;
/** Le clic doit dépasser le fond d'au moins ce rapport… */
const RAPPORT_MIN = 8;
/** …et d'un seuil absolu, pour ne pas mesurer du bruit. */
const AMPLITUDE_MIN = 0.02;

/** Amplitude de la composante `frequence` sur `[debut, debut + n)` (Goertzel, Hann). */
function amplitude(
  lire: (frame: number) => number,
  debut: number,
  n: number,
  frequence: number,
  sampleRate: number,
): number {
  const coeff = 2 * Math.cos((2 * Math.PI * frequence) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s0 = lire(debut + i) * hann + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  // Normalisée : une sinusoïde d'amplitude 1 donne ~1.
  return (Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) * 4) / n;
}

/**
 * Délai entre `clic` (index d'échantillon programmé) et l'arrivée du clic
 * dans le signal, en échantillons, ou `null` s'il n'est pas entendu.
 */
export function delaiClic(
  lire: (frame: number) => number,
  clic: number,
  sampleRate: number,
  frequence = FREQUENCE_DECOMPTE,
): number | null {
  // Fond : juste avant l'instant programmé, là où le clic ne peut pas encore
  // être arrivé.
  const fond: number[] = [];
  for (let f = clic - Math.round(0.05 * sampleRate); f + FENETRE <= clic; f += PAS) {
    fond.push(amplitude(lire, f, FENETRE, frequence, sampleRate));
  }
  fond.sort((a, b) => a - b);
  const niveauFond = fond[Math.floor(fond.length / 2)] ?? 0;
  const seuil = Math.max(AMPLITUDE_MIN, niveauFond * RAPPORT_MIN);

  const fin = clic + Math.round(LATENCE_MAX_S * sampleRate);
  for (let f = clic; f + FENETRE <= fin; f += PAS) {
    if (amplitude(lire, f, FENETRE, frequence, sampleRate) > seuil) {
      // La fenêtre qui franchit le seuil contient le début du clic ; on le
      // date à son milieu, au plus près de l'instant où il a commencé.
      return f + FENETRE / 2;
    }
  }
  return null;
}

/**
 * Accumule le signal brut du micro et mesure les clics annoncés.
 *
 * `clic(time)` annonce un clic de décompte (horloge du contexte) ; il est
 * mesuré dès que le signal couvre sa fenêtre de recherche. `latence()` rend
 * la médiane des mesures, ou `null` tant qu'aucun clic n'a été entendu.
 */
export class MesureLatence {
  private readonly sampleRate: number;
  private readonly ring: Float32Array;
  private written = -1;
  private attente: number[] = [];
  private readonly mesures: number[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.ring = new Float32Array(Math.round(sampleRate * 2));
  }

  push(frame: number, samples: Float32Array): void {
    if (this.written >= 0 && frame !== this.written) this.attente = [];
    for (let i = 0; i < samples.length; i += 1) {
      this.ring[(frame + i) % this.ring.length] = samples[i] ?? 0;
    }
    this.written = frame + samples.length;

    const fin = Math.round(LATENCE_MAX_S * this.sampleRate) + FENETRE;
    const prets = this.attente.filter((clic) => clic + fin <= this.written);
    if (prets.length === 0) return;
    this.attente = this.attente.filter((clic) => clic + fin > this.written);
    const plusAncien = this.written - this.ring.length;
    const lire = (f: number): number =>
      f < plusAncien || f >= this.written ? 0 : (this.ring[f % this.ring.length] ?? 0);
    for (const clic of prets) {
      const delai = delaiClic(lire, clic, this.sampleRate);
      if (delai !== null) this.mesures.push((delai - clic) / this.sampleRate);
    }
  }

  clic(time: number): void {
    this.attente.push(Math.round(time * this.sampleRate));
  }

  /** Médiane des clics entendus, en secondes, ou `null`. */
  latence(): number | null {
    if (this.mesures.length === 0) return null;
    const triees = [...this.mesures].sort((a, b) => a - b);
    return triees[Math.floor(triees.length / 2)] ?? null;
  }

  get entendus(): number {
    return this.mesures.length;
  }
}

/**
 * Latence que le navigateur annonce, faute de mieux (au casque) : sortie
 * (`outputLatency`, `baseLatency`) plus entrée (`latency` du micro, quand il
 * la donne). Sous-estime en pratique — 51 ms annoncées pour 83 mesurées.
 */
export function latenceEstimee(context: AudioContext, track?: MediaStreamTrack): number {
  const sortie = ('outputLatency' in context ? context.outputLatency : 0) + (context.baseLatency ?? 0);
  const reglages = track?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  return sortie + (reglages?.latency ?? 0);
}
