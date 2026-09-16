/** Détection de hauteur au micro, pour juger un arpège joué au métronome.
 *
 * Écrit à la main comme le reste du projet : l'algorithme — une autocorrélation
 * normalisée (méthode McLeod) — tient en une page, et le travail réel est le
 * raccordement du micro, qu'aucune bibliothèque ne dispenserait d'écrire.
 *
 * Trois choix méritent une explication.
 *
 * **On détecte par attaque, pas en continu.** À la guitare, la note précédente
 * sonne encore quand la suivante est jouée, et une autocorrélation se verrouille
 * alors sur la période commune aux deux — souvent une note que personne n'a
 * jouée. On repère donc la montée d'énergie, puis on estime la hauteur sur la
 * fenêtre qui *suit* l'attaque, là où la note neuve domine le plus nettement
 * celle qui meurt.
 *
 * **La capture passe par un `AudioWorklet`, pas par un `AnalyserNode`.** Un
 * analyseur ne rend que les N derniers échantillons au moment où on
 * l'interroge : quand on sait qu'il y a eu une attaque, la fenêtre qu'il
 * propose l'enjambe déjà — moitié note neuve, moitié note précédente. C'était
 * la cause du gros des notes manquées. Le worklet sort un flux continu et daté
 * (`pitch-capture.worklet.js`) dans lequel on découpe après coup exactement la
 * fenêtre voulue : celle qui commence à l'attaque.
 *
 * **L'analyse d'attaque tourne à pas fixe.** Elle avance par pas de `HOP`
 * échantillons sur le flux, et non au rythme de `requestAnimationFrame` : la
 * détection ne dépend plus de la fréquence de rafraîchissement de l'écran, qui
 * faisait varier la sensibilité d'une machine à l'autre.
 */

import { midiFromFrequency } from './technique/theorie';
import workletUrl from './pitch-capture.worklet.js?url';

/** Fenêtre d'estimation de hauteur, en échantillons : ~46 ms à 44,1 kHz.
 *
 * Courte, et c'est délibéré. On pourrait croire qu'il faut de la durée pour
 * tenir les notes graves — trois périodes à peine du si grave d'une 7 cordes.
 * Mesuré, c'est l'inverse : l'autocorrélation normalisée les retrouve sans
 * peine (clarté 0,97 sur B1), tandis que chaque milliseconde de plus laisse
 * entrer les notes précédentes, qui sonnent encore. Comparées sur un arpège
 * laissé sonner, 46 ms donnent 8 notes justes sur 8 là où 70 et 93 ms en
 * perdent une : la contamination coûte plus cher que la brièveté ne rapporte. */
const PITCH_WINDOW = 2048;

/** Pas d'avance de l'analyse d'attaque : ~2,9 ms. */
const HOP = 128;

/** Fenêtre de mesure du niveau courant : ~5,8 ms. */
const FAST = 256;

/**
 * Vitesse à laquelle l'enveloppe de référence redescend, par pas de `HOP`.
 *
 * L'enveloppe monte d'un coup et redescend lentement (~150 ms de constante de
 * temps). C'est ce qui distingue une vraie attaque d'un remous : comparer le
 * niveau du moment à celui juste avant paraît naturel, mais quand six cordes
 * sonnent encore, leurs partiels battent entre eux et le niveau oscille assez
 * pour franchir n'importe quel rapport — on déclenchait alors en rafale dans la
 * traîne d'un arpège, et ces fausses attaques bloquaient les vraies par l'écart
 * minimal. Face à une enveloppe qui garde la mémoire du dernier sommet, une
 * note qui décroît ne peut plus se redéclencher elle-même.
 */
const RELEASE = 0.06;

/** Énergie en deçà de laquelle on considère qu'on n'a rien joué. */
const SILENCE_RMS = 0.008;

/** Énergie jugée « forte », pour ramener le niveau affiché entre 0 et 1. */
const LOUD_RMS = 0.25;

/** Rapport qui fait une attaque, entre le niveau courant et l'enveloppe.
 *
 * Réglé au banc d'essai, avec `RELEASE`, sur un arpège de huit notes laissé
 * sonner : ce couple retrouve les huit notes de 1000 à 250 ms d'écart — quatre
 * fois le tempo par défaut — sans jamais déclencher à vide. Monter le rapport
 * ne supprime rien mais fait manquer des notes ; le descendre ne gagne rien et
 * finit par prendre les remous de la traîne pour des attaques. */
const RISE_FACTOR = 1.4;

/** Écart minimal entre deux attaques : au-delà, on double-compterait une note. */
const MIN_GAP_S = 0.07;

/** En deçà, le son n'est pas assez périodique pour qu'on l'appelle une note.
 *
 * Mesuré sur l'arpège d'essai, une note juste tombe entre 0,74 et 0,99 : plus
 * elle arrive tard dans l'arpège, plus ce qui sonne encore la brouille. Le
 * bruit blanc et le souffle secteur, eux, ne produisent aucun pic — c'est
 * l'absence de périodicité, pas sa faiblesse, qui les écarte. D'où un seuil
 * assez bas pour garder les notes de fin d'arpège. */
const MIN_CLARITY = 0.7;

/** Bornes de recherche. La guitare 7 cordes descend à C2 (36) et monte à E5
 *  (76) : on garde un ton de marge en bas, et de quoi suivre une harmonique
 *  franche en haut. Chercher plus bas coûterait des `tau` pour rien. */
const MIN_MIDI = 34;
const MAX_MIDI = 88;

export interface Onset {
  /** Instant `AudioContext.currentTime` de l'attaque. */
  audioTime: number;
  /** Hauteur estimée, arrondie au demi-ton. */
  midi: number;
  /** Fréquence mesurée, en hertz, avant arrondi. */
  frequency: number;
  /** Écart au demi-ton tempéré le plus proche, en centièmes (−50 à +50). */
  cents: number;
  /** Périodicité du signal (0–1) : sert de mesure de confiance. */
  clarte: number;
}

/**
 * Détection d'attaques et de hauteurs sur un flux d'échantillons daté.
 *
 * Volontairement séparé de tout Web Audio : c'est ici que vit la logique, et
 * elle se teste en alimentant `push()` avec des signaux synthétiques
 * (`pitch.unit.test.ts`) plutôt qu'en pilotant un navigateur.
 */
export class PitchStream {
  private readonly sampleRate: number;
  private readonly onOnset: (onset: Onset) => void;
  private readonly onLevel?: (level: number) => void;
  private readonly ring: Float32Array;
  private readonly minGapFrames: number;

  /** Index absolu du premier échantillon jamais reçu. */
  private origin = -1;
  /** Index absolu de l'échantillon qui suit le dernier reçu. */
  private written = 0;
  /** Index absolu jusqu'où l'analyse d'attaque est allée. */
  private scanned = 0;
  private lastOnsetFrame = -Infinity;
  /** Niveau de référence : monte d'un coup, redescend lentement. */
  private envelope = 0;
  /** Attaques repérées dont la fenêtre de hauteur n'est pas encore complète. */
  private pending: number[] = [];

  constructor(
    sampleRate: number,
    onOnset: (onset: Onset) => void,
    onLevel?: (level: number) => void,
  ) {
    this.sampleRate = sampleRate;
    this.onOnset = onOnset;
    this.onLevel = onLevel;
    // Une seconde de mémoire : très au-delà de ce qu'on relit (70 ms), mais de
    // quoi encaisser un fil principal momentanément occupé.
    this.ring = new Float32Array(Math.max(sampleRate, PITCH_WINDOW * 4));
    this.minGapFrames = Math.round(MIN_GAP_S * sampleRate);
  }

  /** Reçoit un lot d'échantillons contigus commençant à l'index absolu `frame`. */
  push(frame: number, samples: Float32Array): void {
    if (this.origin < 0 || frame !== this.written) {
      // Premier lot, ou trou dans le flux (fil principal bloqué assez longtemps
      // pour qu'un lot se perde) : on repart de ce qu'on a plutôt que
      // d'analyser un raccord qui n'a jamais existé.
      this.origin = frame;
      this.written = frame;
      this.scanned = frame;
      this.pending = [];
      this.lastOnsetFrame = -Infinity;
      this.envelope = 0;
    }

    for (let i = 0; i < samples.length; i += 1) {
      this.ring[(this.written + i) % this.ring.length] = samples[i] ?? 0;
    }
    this.written += samples.length;

    this.onLevel?.(Math.min(1, rootMeanSquare(samples) / LOUD_RMS));
    this.scanOnsets();
    this.measureReady();
  }

  /** Oublie tout : utilisé quand l'écoute s'arrête puis reprend. */
  reset(): void {
    this.origin = -1;
    this.written = 0;
    this.scanned = 0;
    this.lastOnsetFrame = -Infinity;
    this.envelope = 0;
    this.pending = [];
  }

  /** Niveau efficace sur `[from, to)`, en index absolus. */
  private rms(from: number, to: number): number {
    let sum = 0;
    for (let f = from; f < to; f += 1) {
      const value = this.ring[((f % this.ring.length) + this.ring.length) % this.ring.length] ?? 0;
      sum += value * value;
    }
    return Math.sqrt(sum / Math.max(1, to - from));
  }

  private sample(frame: number): number {
    return this.ring[((frame % this.ring.length) + this.ring.length) % this.ring.length] ?? 0;
  }

  private scanOnsets(): void {
    // `p` est la fin de la fenêtre de mesure : il lui faut `FAST` échantillons
    // derrière elle avant de vouloir dire quoi que ce soit.
    let p = Math.max(this.scanned, this.origin + FAST);
    for (; p <= this.written; p += HOP) {
      const level = this.rms(p - FAST, p);
      const reference = this.envelope;

      // L'enveloppe suit le sommet immédiatement et ne lâche qu'ensuite : le
      // test se fait donc toujours contre le niveau d'avant, jamais contre
      // celui que l'attaque vient elle-même d'établir.
      this.envelope =
        level > this.envelope ? level : this.envelope + (level - this.envelope) * RELEASE;

      if (level <= SILENCE_RMS) continue;
      if (level <= reference * RISE_FACTOR) continue;
      if (p - this.lastOnsetFrame < this.minGapFrames) continue;

      const attack = this.locateAttack(p, reference);
      this.lastOnsetFrame = attack;
      this.pending.push(attack);
    }
    this.scanned = p;
  }

  /**
   * Situe l'attaque à l'intérieur de la fenêtre courte.
   *
   * Dater l'attaque à la fin de la fenêtre la ferait paraître en retard de
   * toute sa longueur ; la dater au début, en avance dès que la montée est
   * lente. On cherche donc le premier échantillon qui sort franchement du
   * fond — c'est le moment où la corde a été touchée.
   */
  private locateAttack(windowEnd: number, floor: number): number {
    const threshold = Math.max(SILENCE_RMS, floor * 2);
    for (let f = windowEnd - FAST; f < windowEnd; f += 1) {
      if (Math.abs(this.sample(f)) > threshold) return f;
    }
    return windowEnd - FAST;
  }

  /** Mesure la hauteur des attaques dont la fenêtre est enfin complète. */
  private measureReady(): void {
    const ready = this.pending.filter((attack) => attack + PITCH_WINDOW <= this.written);
    if (ready.length === 0) return;
    this.pending = this.pending.filter((attack) => attack + PITCH_WINDOW > this.written);

    for (const attack of ready) {
      const window = new Float32Array(PITCH_WINDOW);
      for (let i = 0; i < PITCH_WINDOW; i += 1) window[i] = this.sample(attack + i);

      const found = detectPitch(window, this.sampleRate);
      if (!found) continue;

      const exact = midiFromFrequency(found.frequency);
      const midi = Math.round(exact);
      this.onOnset({
        audioTime: attack / this.sampleRate,
        midi,
        frequency: found.frequency,
        cents: Math.round((exact - midi) * 100),
        clarte: found.clarity,
      });
    }
  }
}

export class PitchTracker {
  private readonly context: AudioContext;
  private readonly onOnset: (onset: Onset) => void;
  private readonly onLevel?: (level: number) => void;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private pitchStream: PitchStream | null = null;

  /**
   * `onLevel` publie le niveau sonore courant (0–1) à chaque lot, qu'il y ait
   * ou non une attaque : c'est ce qui alimente un simple VU-mètre, la seule
   * preuve continue que le micro capte quelque chose.
   */
  constructor(
    context: AudioContext,
    onOnset: (onset: Onset) => void,
    onLevel?: (level: number) => void,
  ) {
    this.context = context;
    this.onOnset = onOnset;
    this.onLevel = onLevel;
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

    await this.context.audioWorklet.addModule(workletUrl);

    this.pitchStream = new PitchStream(this.context.sampleRate, this.onOnset, this.onLevel);
    this.source = this.context.createMediaStreamSource(this.stream);
    // Aucune sortie : le nœud consomme le micro et ne rejoue rien. C'est aussi
    // ce qui le garde actif sans passer par `destination`.
    this.node = new AudioWorkletNode(this.context, 'pitch-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (event: MessageEvent<{ frame: number; samples: Float32Array }>) => {
      this.pitchStream?.push(event.data.frame, event.data.samples);
    };

    this.source.connect(this.node);
  }

  get listening(): boolean {
    return this.stream !== null;
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.source = null;
    this.node = null;
    this.pitchStream = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  destroy(): void {
    this.stop();
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
 * et non le plus haut lui-même. C'est la règle de McLeod, et elle n'est pas
 * négociable : un signal de période T se ressemble aussi à 2T, 3T… — les pics
 * y sont presque aussi hauts, et lequel gagne ne tient qu'au bruit. Prendre le
 * plus haut donnerait donc une octave trop bas au hasard des prises. Le seuil
 * (0,9) est le seul réglage : plus haut, on glisse vers l'octave grave ; plus
 * bas, vers l'aiguë.
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
  const chosen = peaks.find((peak) => (nsdf[peak] ?? 0) >= 0.9 * highest);
  if (chosen === undefined) return null;
  // Le seuil porte sur le pic effectivement retenu, et non sur le plus haut :
  // c'est celui-là qu'on s'apprête à appeler une note, et c'est donc sa
  // périodicité à lui qui doit convaincre.
  if ((nsdf[chosen] ?? 0) < MIN_CLARITY) return null;

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
