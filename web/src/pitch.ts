/** Détection de hauteur au micro, pour juger un arpège joué au métronome.
 *
 * Écrit à la main comme le reste du projet : l'algorithme — une autocorrélation
 * normalisée (méthode McLeod) — tient en une page, et le travail réel est le
 * raccordement du micro, qu'aucune bibliothèque ne dispenserait d'écrire.
 *
 * Deux choix méritent une explication.
 *
 * **On détecte par attaque, pas en continu.** À la guitare, la note précédente
 * sonne encore quand la suivante est jouée, et une autocorrélation se verrouille
 * alors sur la plus grave ou la plus forte — souvent la note qui meurt. On
 * repère donc la montée d'énergie, puis on estime la hauteur quelques
 * dizaines de millisecondes plus tard, là où la note neuve domine encore. Le
 * procédé tient tant que les notes sont détachées ; il se dégrade quand elles
 * se recouvrent longuement.
 *
 * **Deux fenêtres, pas une.** L'attaque se repère sur une fenêtre courte, qui
 * la situe précisément dans le temps ; la hauteur se calcule sur une fenêtre
 * longue, car le mi grave de la guitare (82 Hz) n'entre pas deux fois dans une
 * fenêtre courte. Utiliser la longue pour les deux daterait chaque attaque avec
 * près de cent millisecondes de retard, ce qui ruinerait le jugement du
 * placement rythmique.
 */

import { midiFromFrequency } from './technique/theorie';

/** Fenêtre de datation de l'attaque : ~23 ms à 44,1 kHz. */
const ONSET_FFT = 1024;

/** Fenêtre d'estimation de hauteur : ~93 ms, deux périodes du mi grave. */
const PITCH_FFT = 4096;

/** Délai entre l'attaque et la mesure, le temps que la note neuve s'impose. */
const PITCH_DELAY_MS = 45;

/** Énergie en deçà de laquelle on considère qu'on n'a rien joué. */
const SILENCE_RMS = 0.008;

/** Rapport d'énergie qui fait une attaque, comparé à la fenêtre précédente. */
const RISE_FACTOR = 1.8;

/** Écart minimal entre deux attaques : au-delà, on double-compterait une note. */
const MIN_GAP_S = 0.07;

/** En deçà, le son n'est pas assez périodique pour qu'on l'appelle une note. */
const MIN_CLARITY = 0.85;

/** Bornes de recherche : du mi grave de la guitare à deux octaves au-dessus. */
const MIN_MIDI = 38;
const MAX_MIDI = 92;

export interface Onset {
  /** Instant `AudioContext.currentTime` de l'attaque. */
  audioTime: number;
  /** Hauteur estimée, arrondie au demi-ton. */
  midi: number;
  /** Périodicité du signal (0–1) : sert de mesure de confiance. */
  clarte: number;
}

export class PitchTracker {
  private readonly context: AudioContext;
  private readonly onOnset: (onset: Onset) => void;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onsetAnalyser: AnalyserNode | null = null;
  private pitchAnalyser: AnalyserNode | null = null;
  private frame: number | null = null;
  private onsetBuffer = new Float32Array(ONSET_FFT);
  private pitchBuffer = new Float32Array(PITCH_FFT);
  private previousRms = 0;
  private lastOnsetAt = -Infinity;
  private pending: number[] = [];

  constructor(context: AudioContext, onOnset: (onset: Onset) => void) {
    this.context = context;
    this.onOnset = onOnset;
  }

  /**
   * Les traitements de la chaîne de capture — annulation d'écho, réduction de
   * bruit, gain automatique — sont désactivés : ils déforment la hauteur et
   * écrêtent les attaques, c'est-à-dire exactement ce qu'on mesure.
   */
  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.source = this.context.createMediaStreamSource(this.stream);

    this.onsetAnalyser = this.context.createAnalyser();
    this.onsetAnalyser.fftSize = ONSET_FFT;
    this.pitchAnalyser = this.context.createAnalyser();
    this.pitchAnalyser.fftSize = PITCH_FFT;

    this.source.connect(this.onsetAnalyser);
    this.source.connect(this.pitchAnalyser);
    // Rien n'est reconnecté à `destination` : on écoute, on ne rejoue pas.

    this.previousRms = 0;
    this.lastOnsetAt = -Infinity;
    this.frame = window.requestAnimationFrame(() => this.poll());
  }

  get listening(): boolean {
    return this.stream !== null;
  }

  stop(): void {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const timer of this.pending) window.clearTimeout(timer);
    this.pending = [];
    this.source?.disconnect();
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.onsetAnalyser = null;
    this.pitchAnalyser = null;
  }

  destroy(): void {
    this.stop();
  }

  private poll(): void {
    const analyser = this.onsetAnalyser;
    if (!analyser) return;

    analyser.getFloatTimeDomainData(this.onsetBuffer);
    const rms = rootMeanSquare(this.onsetBuffer);
    const now = this.context.currentTime;

    const rising = rms > SILENCE_RMS && rms > this.previousRms * RISE_FACTOR;
    if (rising && now - this.lastOnsetAt > MIN_GAP_S) {
      this.lastOnsetAt = now;
      // La fenêtre couvre les 23 dernières millisecondes, et l'attaque s'y
      // trouve quelque part : la dater à `now` la ferait paraître en retard
      // d'une fenêtre entière. Son milieu est la meilleure estimation à
      // moindres frais — sans quoi tout le jeu semblerait systématiquement
      // traîner, ce qui fausserait le seul chiffre censé mesurer le placement.
      const attackTime = now - ONSET_FFT / (2 * this.context.sampleRate);
      this.measureAfterAttack(attackTime);
    }
    this.previousRms = rms;

    this.frame = window.requestAnimationFrame(() => this.poll());
  }

  /** Mesure la hauteur peu après l'attaque, et rapporte l'instant de l'attaque. */
  private measureAfterAttack(attackTime: number): void {
    const timer = window.setTimeout(() => {
      this.pending = this.pending.filter((id) => id !== timer);
      const analyser = this.pitchAnalyser;
      if (!analyser) return;

      analyser.getFloatTimeDomainData(this.pitchBuffer);
      const found = detectPitch(this.pitchBuffer, this.context.sampleRate);
      if (!found) return;

      this.onOnset({
        audioTime: attackTime,
        midi: Math.round(midiFromFrequency(found.frequency)),
        clarte: found.clarity,
      });
    }, PITCH_DELAY_MS);
    this.pending.push(timer);
  }
}

function rootMeanSquare(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += (buffer[i] ?? 0) ** 2;
  return Math.sqrt(sum / buffer.length);
}

/**
 * Hauteur d'une fenêtre, par autocorrélation normalisée.
 *
 * Le balayage part de tau = 1, et non du plus petit décalage utile : la courbe
 * commence à 1 et redescend, si bien que démarrer au milieu de ce lobe initial
 * y trouverait un sommet artificiel — le signal se ressemble trivialement à
 * lui-même sur un décalage très court. On enjambe donc ce premier lobe jusqu'au
 * premier passage par zéro, puis on ne retient que les sommets qui tombent dans
 * la tessiture de la guitare.
 *
 * Le pic retenu est le **premier** qui dépasse un seuil relatif au plus haut,
 * et non le plus haut lui-même : sur un son riche en harmoniques, le plus haut
 * tombe souvent une octave trop bas.
 */
export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
): { frequency: number; clarity: number } | null {
  const minTau = Math.max(2, Math.floor(sampleRate / frequencyFromMidi(MAX_MIDI)));
  const maxTau = Math.min(
    buffer.length - 1,
    Math.ceil(sampleRate / frequencyFromMidi(MIN_MIDI)),
  );
  if (maxTau <= minTau) return null;

  const nsdf = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let correlation = 0;
    let energy = 0;
    for (let i = 0; i + tau < buffer.length; i += 1) {
      const a = buffer[i] ?? 0;
      const b = buffer[i + tau] ?? 0;
      correlation += a * b;
      energy += a * a + b * b;
    }
    nsdf[tau] = energy > 0 ? (2 * correlation) / energy : 0;
  }

  // Enjamber le lobe initial, qui ne correspond à aucune période.
  let tau = 1;
  while (tau <= maxTau && (nsdf[tau] ?? 0) > 0) tau += 1;

  // Sommets des lobes positifs : un maximum local par période candidate.
  const peaks: number[] = [];
  while (tau < maxTau) {
    if ((nsdf[tau] ?? 0) > 0 && (nsdf[tau - 1] ?? 0) <= 0) {
      let best = tau;
      while (tau < maxTau && (nsdf[tau] ?? 0) > 0) {
        if ((nsdf[tau] ?? 0) > (nsdf[best] ?? 0)) best = tau;
        tau += 1;
      }
      if (best >= minTau) peaks.push(best);
    }
    tau += 1;
  }
  if (peaks.length === 0) return null;

  const highest = Math.max(...peaks.map((peak) => nsdf[peak] ?? 0));
  if (highest < MIN_CLARITY) return null;
  const chosen = peaks.find((peak) => (nsdf[peak] ?? 0) >= 0.9 * highest);
  if (chosen === undefined) return null;

  // Interpolation parabolique : sans elle, la hauteur est quantifiée par
  // l'échantillonnage, soit près d'un demi-ton dans l'aigu.
  const left = nsdf[chosen - 1] ?? 0;
  const middle = nsdf[chosen] ?? 0;
  const right = nsdf[chosen + 1] ?? 0;
  const divisor = 2 * (2 * middle - left - right);
  const shift = divisor === 0 ? 0 : (right - left) / divisor;

  return { frequency: sampleRate / (chosen + shift), clarity: middle };
}

function frequencyFromMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
