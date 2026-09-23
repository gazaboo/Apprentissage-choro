/** Rejeu hors ligne d'une prise de micro, dans les conditions du navigateur.
 *
 * Même découpage en lots de 512 que `pitch-capture.worklet.js`, mêmes
 * coupe-bandes que `PitchTracker` (formules de la spécification Web Audio pour
 * `BiquadFilterNode` de type `notch`) : ce qui sort d'ici est ce que la page
 * aurait détecté sur la même prise. En plus, chaque note est datée de l'instant
 * où elle a été **rendue**, ce qui mesure la latence de la détection elle-même.
 */

import { CLICK_HZ, CLICK_Q, PitchStream, type Onset, type PitchReglages } from './pitch';

export interface OnsetRejoue extends Onset {
  /** Instant (s, depuis le début de la prise) où la note est sortie du flux. */
  emisA: number;
}

/** Coupe-bande biquad, tel que `BiquadFilterNode` le calcule. */
export function notch(input: Float32Array, sampleRate: number, frequency: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = 1 / a0;
  const b1 = (-2 * cos) / a0;
  const b2 = 1 / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i] ?? 0;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Applique la chaîne d'entrée de `PitchTracker` (les trois coupe-bandes). */
export function chaineEntree(samples: Float32Array, sampleRate: number): Float32Array {
  return CLICK_HZ.reduce((signal, frequency) => notch(signal, sampleRate, frequency, CLICK_Q), samples);
}

/** Fait passer une prise par `PitchStream`, par lots de 512, comme la page. */
export function rejouer(
  samples: Float32Array,
  sampleRate: number,
  options: { filtrer?: boolean; reglages?: Partial<PitchReglages> } = {},
): OnsetRejoue[] {
  const signal = options.filtrer === false ? samples : chaineEntree(samples, sampleRate);
  const heard: OnsetRejoue[] = [];
  let fin = 0;
  const stream = new PitchStream(
    sampleRate,
    (onset) => heard.push({ ...onset, emisA: fin / sampleRate }),
    undefined,
    options.reglages,
  );
  const BATCH = 512;
  for (let frame = 0; frame + BATCH <= signal.length; frame += BATCH) {
    fin = frame + BATCH;
    stream.push(frame, signal.slice(frame, frame + BATCH));
  }
  return heard;
}

export interface NoteVerite {
  /** Instant de l'attaque, en secondes depuis le début de la prise. */
  t: number;
  midi: number;
}

export interface ScorePrise {
  notes: number;
  justes: number;
  /** Bon nom de note, mauvaise octave. */
  octave: number;
  /** Détectées au bon moment, mais sur une autre note. */
  fausses: number;
  manquees: number;
  /** Détections qui ne correspondent à aucune note jouée. */
  enTrop: number;
  /** Délai médian entre l'attaque réelle et la sortie de la note, en ms. */
  renduMedianMs: number;
}

/**
 * Confronte les détections à ce qui a réellement été joué : chaque note
 * jouée prend la détection la plus proche à `tolerance` près.
 */
export function noterPrise(
  detections: OnsetRejoue[],
  verite: NoteVerite[],
  tolerance = 0.1,
): ScorePrise {
  const prises = new Set<number>();
  const score: ScorePrise = {
    notes: verite.length,
    justes: 0,
    octave: 0,
    fausses: 0,
    manquees: 0,
    enTrop: 0,
    renduMedianMs: 0,
  };
  const rendus: number[] = [];
  for (const note of verite) {
    let meilleure = -1;
    detections.forEach((d, i) => {
      if (prises.has(i) || Math.abs(d.audioTime - note.t) > tolerance) return;
      if (meilleure < 0 || Math.abs(d.audioTime - note.t) < Math.abs((detections[meilleure]?.audioTime ?? 0) - note.t)) {
        meilleure = i;
      }
    });
    const d = detections[meilleure];
    if (!d) {
      score.manquees += 1;
      continue;
    }
    prises.add(meilleure);
    rendus.push(d.emisA - note.t);
    if (d.midi === note.midi) score.justes += 1;
    else if ((d.midi - note.midi) % 12 === 0) score.octave += 1;
    else score.fausses += 1;
  }
  score.enTrop = detections.length - prises.size;
  rendus.sort((a, b) => a - b);
  score.renduMedianMs = Math.round((rendus[Math.floor(rendus.length / 2)] ?? 0) * 1000);
  return score;
}
