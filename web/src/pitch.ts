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
import type { JournalMicro } from './diagnostic-micro';

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

/** Bornes de recherche : la guitare 7 cordes va de C2 (36) à E5 (76), plus un
 *  ton de marge de part et d'autre.
 *
 *  Le haut est serré exprès. Chercher jusqu'à 1300 Hz laissait le détecteur
 *  nommer des sons qu'aucune guitare ne peut produire — à commencer par le
 *  clic du métronome, qui repassait en B5. Ce qui sort de la tessiture de
 *  l'instrument ne vient pas de l'instrument. */
const MIN_MIDI = 34;
const MAX_MIDI = 78;

/**
 * Fréquences du clic du métronome (`metronome.ts`), à retirer de l'entrée.
 *
 * Le clic sort dans les haut-parleurs, le micro l'entend, et comme c'est une
 * sinusoïde pure il est plus périodique que n'importe quelle corde : le
 * détecteur le préférait à la note jouée et annonçait un B5 (l'accent à
 * 1000 Hz) ou un G5 (la battue à 800 Hz), pile sur le temps.
 *
 * Trois cloches étroites suffisent à l'effacer. Une corde, elle, répartit son
 * énergie sur une douzaine de partiels : lui en retirer trois bandes de
 * quelques dizaines de hertz ne coûte que 0,01 de clarté — mesuré — parce que
 * l'autocorrélation ne dépend pas de la forme du spectre, seulement de sa
 * périodicité.
 */
export const CLICK_HZ = [600, 800, 1000];

/** Étroitesse des cloches : assez fines pour ne mordre que sur le clic. */
export const CLICK_Q = 20;

/**
 * Réglages de la détection, regroupés pour pouvoir les comparer au banc
 * d'essai sur des prises réelles (`micro-replay.unit.test.ts`). La page
 * n'utilise que `REGLAGES_DEFAUT`.
 */
export interface PitchReglages {
  /** Longueur de la fenêtre de hauteur, en échantillons. */
  fenetre: number;
  /** Retard du début de la fenêtre de hauteur sur l'attaque, en ms. */
  delaiMs: number;
  /** Rapport niveau/enveloppe qui fait une attaque. */
  montee: number;
  /** Vitesse de redescente de l'enveloppe, par pas de `HOP`. */
  relache: number;
  /** Clarté minimale pour appeler une note. */
  clarteMin: number;
  /** Seuil relatif du premier pic retenu (règle de McLeod). */
  seuilPic: number;
  /**
   * Grandeur suivie pour repérer les attaques : le niveau (`rms`), ou le
   * niveau de la dérivée (`derivee`), qui fait ressortir le transitoire de
   * l'attaque même quand le signal plafonne.
   */
  attaque: 'rms' | 'derivee';
  /** Nombre de fenêtres successives (décalées d'une demi-fenêtre) qui votent. */
  votes: number;
  /** Note la plus grave cherchée (MIDI). */
  minMidi: number;
  /**
   * Vérification spectrale de l'octave, sur `fenetreOctave` échantillons :
   * `bas` est le rapport au-delà duquel on descend d'une octave (les partiels
   * impairs de f/2 sont là), `haut` celui en deçà duquel on monte (les
   * partiels impairs de f manquent). `null` : pas de vérification.
   */
  octave: { bas: number; haut: number } | null;
  fenetreOctave: number;
}

/**
 * Réglages retenus au banc d'essai sur six prises réelles (guitare 7 cordes,
 * `src/__fixtures__/micro/`, 141 notes établies) : 110 justes contre 22 avec
 * la version précédente, réglée sur des cordes synthétiques. Ce qui compte,
 * par ordre d'effet :
 *
 * - **mesurer 100 ms après l'attaque**, pas dessus : le médiator, et plus
 *   encore un micro un peu fort, déforment les premières dizaines de
 *   millisecondes — c'est là que la hauteur sortait à l'octave ou pas du tout ;
 * - **vérifier l'octave sur le spectre** (`corrigerOctave`) : l'autocorrélation
 *   seule rendait les si et les mi graves à l'octave au-dessus ;
 * - repérer l'attaque sur la **dérivée**, qui fait ressortir le coup de
 *   médiator même quand d'autres cordes sonnent encore ;
 * - s'arrêter à B1 : rien ne sonne plus bas sur une 7 cordes accordée en do,
 *   et chercher plus bas laissait prendre un sous-multiple pour une note.
 *
 * Le prix est le délai d'affichage : ~175 ms entre l'attaque et la note
 * rendue. Il ne fausse pas le placement rythmique, l'attaque restant datée à
 * l'instant où la corde a été touchée.
 */
export const REGLAGES_DEFAUT: PitchReglages = {
  fenetre: PITCH_WINDOW,
  delaiMs: 100,
  montee: RISE_FACTOR,
  relache: RELEASE,
  clarteMin: 0.5,
  seuilPic: 0.95,
  attaque: 'derivee',
  votes: 1,
  minMidi: 35,
  octave: { bas: 0.35, haut: 0.1 },
  fenetreOctave: 3072,
};

/**
 * Repère un micro qui sature.
 *
 * Mesuré sur des prises réelles : un gain d'entrée trop fort écrêtait jusqu'à
 * 78 % des échantillons d'une attaque — un signal presque carré, où la hauteur
 * sort à l'octave au-dessus ou pas du tout (2 notes justes sur 15). Aucun
 * réglage de la détection ne rattrape ça aussi bien que baisser le micro : il
 * faut donc le dire. On compte la part d'échantillons proches du plafond sur
 * une fenêtre glissante, avec une hystérésis pour que l'alerte ne clignote pas
 * d'une note à l'autre.
 */
export class DetecteurSaturation {
  /** Au-delà, un échantillon est compté comme touchant le plafond. Mesuré
   *  après les coupe-bandes, qui arrondissent un peu les plateaux écrêtés. */
  static readonly PLAFOND = 0.9;
  /** Part d'échantillons au plafond qui déclenche l'alerte…
   *
   *  Mesurée sur 1,5 s de prises réelles : 20 à 29 % au pire quand le micro
   *  sature, au plus 1,1 % une fois le gain baissé — une attaque un peu forte
   *  touche le plafond sans rien gâcher. 3 % se tient loin des deux. */
  static readonly DECLENCHE = 0.03;
  /** …et celle sous laquelle elle retombe. */
  static readonly RETOMBE = 0.005;

  private readonly capacite: number;
  private lots: { total: number; ecretes: number }[] = [];
  private total = 0;
  private ecretes = 0;
  sature = false;

  /** `dureeS` : longueur de la fenêtre glissante. */
  constructor(sampleRate: number, dureeS = 1.5) {
    this.capacite = Math.round(sampleRate * dureeS);
  }

  /** Ajoute un lot et rend l'état courant. */
  push(samples: Float32Array): boolean {
    let ecretes = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if (Math.abs(samples[i] ?? 0) >= DetecteurSaturation.PLAFOND) ecretes += 1;
    }
    this.lots.push({ total: samples.length, ecretes });
    this.total += samples.length;
    this.ecretes += ecretes;
    while (this.total - (this.lots[0]?.total ?? 0) >= this.capacite && this.lots.length > 1) {
      const ancien = this.lots.shift()!;
      this.total -= ancien.total;
      this.ecretes -= ancien.ecretes;
    }
    const part = this.ecretes / Math.max(1, this.total);
    if (part >= DetecteurSaturation.DECLENCHE) this.sature = true;
    else if (part < DetecteurSaturation.RETOMBE) this.sature = false;
    return this.sature;
  }
}

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
  private readonly onLevel?: (level: number, sature: boolean) => void;
  private readonly saturation: DetecteurSaturation;
  private readonly ring: Float32Array;
  private readonly minGapFrames: number;
  private readonly reglages: PitchReglages;
  private readonly delai: number;
  /** Fin de la dernière fenêtre de vote, depuis l'attaque. */
  private readonly etendue: number;

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
    onLevel?: (level: number, sature: boolean) => void,
    reglages: Partial<PitchReglages> = {},
  ) {
    this.sampleRate = sampleRate;
    this.onOnset = onOnset;
    this.onLevel = onLevel;
    this.reglages = { ...REGLAGES_DEFAUT, ...reglages };
    this.saturation = new DetecteurSaturation(sampleRate);
    this.delai = Math.round((this.reglages.delaiMs / 1000) * sampleRate);
    this.etendue = Math.max(
      this.delai + this.reglages.fenetre + ((this.reglages.votes - 1) * this.reglages.fenetre) / 2,
      this.reglages.octave ? this.delai + this.reglages.fenetreOctave : 0,
    );
    // Une seconde de mémoire : très au-delà de ce qu'on relit (70 ms), mais de
    // quoi encaisser un fil principal momentanément occupé.
    this.ring = new Float32Array(Math.max(sampleRate, this.etendue * 4));
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

    const sature = this.saturation.push(samples);
    this.onLevel?.(Math.min(1, rootMeanSquare(samples) / LOUD_RMS), sature);
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

  /** Niveau efficace de la dérivée première sur `[from, to)`. */
  private rmsDerivee(from: number, to: number): number {
    let sum = 0;
    for (let f = from; f < to; f += 1) {
      const d = this.sample(f) - this.sample(f - 1);
      sum += d * d;
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
      const suivi = this.reglages.attaque === 'derivee' ? this.rmsDerivee(p - FAST, p) : level;
      const reference = this.envelope;

      // L'enveloppe suit le sommet immédiatement et ne lâche qu'ensuite : le
      // test se fait donc toujours contre le niveau d'avant, jamais contre
      // celui que l'attaque vient elle-même d'établir.
      this.envelope =
        suivi > this.envelope
          ? suivi
          : this.envelope + (suivi - this.envelope) * this.reglages.relache;

      if (level <= SILENCE_RMS) continue;
      if (suivi <= reference * this.reglages.montee) continue;
      if (p - this.lastOnsetFrame < this.minGapFrames) continue;

      const attack = this.locateAttack(p, this.reglages.attaque === 'rms' ? reference : 0);
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
    const ready = this.pending.filter((attack) => attack + this.etendue <= this.written);
    if (ready.length === 0) return;
    this.pending = this.pending.filter((attack) => attack + this.etendue > this.written);

    const { fenetre, votes, seuilPic, clarteMin, minMidi, octave, fenetreOctave } = this.reglages;
    for (const attack of ready) {
      const trouves: { frequency: number; clarity: number }[] = [];
      for (let v = 0; v < votes; v += 1) {
        const debut = attack + this.delai + (v * fenetre) / 2;
        const window = new Float32Array(fenetre);
        for (let i = 0; i < fenetre; i += 1) window[i] = this.sample(debut + i);
        const trouve = detectPitch(window, this.sampleRate, { seuilPic, clarteMin, minMidi });
        if (trouve) trouves.push(trouve);
      }
      const vote = voter(trouves);
      if (!vote) continue;
      let found = vote;
      if (octave) {
        const segment = new Float32Array(fenetreOctave);
        for (let i = 0; i < fenetreOctave; i += 1) segment[i] = this.sample(attack + this.delai + i);
        found = {
          ...vote,
          frequency: corrigerOctave(segment, this.sampleRate, vote.frequency, octave, minMidi),
        };
      }

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
  private readonly onLevel?: (level: number, sature: boolean) => void;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private notches: BiquadFilterNode[] = [];
  private pitchStream: PitchStream | null = null;
  /** Second nœud de capture, branché avant les coupe-bandes, pour le journal. */
  private rawNode: AudioWorkletNode | null = null;
  /**
   * Journal de diagnostic (`?debug=micro`) : s'il est posé avant `start()`, le
   * signal brut et chaque note rendue y sont consignés.
   */
  journal: JournalMicro | null = null;

  /**
   * `onLevel` publie le niveau sonore courant (0–1) à chaque lot, qu'il y ait
   * ou non une attaque : c'est ce qui alimente un simple VU-mètre, la seule
   * preuve continue que le micro capte quelque chose. `sature` y dit si
   * l'entrée écrête (voir `DetecteurSaturation`).
   */
  constructor(
    context: AudioContext,
    onOnset: (onset: Onset) => void,
    onLevel?: (level: number, sature: boolean) => void,
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

    const journal = this.journal;
    const onOnset = journal
      ? (onset: Onset): void => {
          journal.onset(onset, this.context);
          this.onOnset(onset);
        }
      : this.onOnset;
    this.pitchStream = new PitchStream(this.context.sampleRate, onOnset, this.onLevel);
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

    // Le clic du métronome est retiré avant toute analyse : voir `CLICK_HZ`.
    this.notches = CLICK_HZ.map((frequency) => {
      const filter = this.context.createBiquadFilter();
      filter.type = 'notch';
      filter.frequency.value = frequency;
      filter.Q.value = CLICK_Q;
      return filter;
    });
    const entree = this.notches.reduce<AudioNode>(
      (amont, filtre) => amont.connect(filtre),
      this.source,
    );
    entree.connect(this.node);

    if (journal) {
      journal.ouvrir(this.context, this.stream.getAudioTracks()[0]);
      this.rawNode = new AudioWorkletNode(this.context, 'pitch-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      this.rawNode.port.onmessage = (
        event: MessageEvent<{ frame: number; samples: Float32Array }>,
      ) => {
        journal.echantillons(event.data.frame, event.data.samples);
      };
      this.source.connect(this.rawNode);
    }
  }

  get listening(): boolean {
    return this.stream !== null;
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    for (const filtre of this.notches) filtre.disconnect();
    this.notches = [];
    this.node?.disconnect();
    if (this.rawNode) this.rawNode.port.onmessage = null;
    this.rawNode?.disconnect();
    this.rawNode = null;
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
  {
    seuilPic = 0.9,
    clarteMin = MIN_CLARITY,
    minMidi = MIN_MIDI,
  }: { seuilPic?: number; clarteMin?: number; minMidi?: number } = {},
): { frequency: number; clarity: number } | null {
  const minTau = Math.max(2, Math.floor(sampleRate / frequencyFromMidi(MAX_MIDI)));
  const maxTau = Math.min(
    buffer.length - 1,
    Math.ceil(sampleRate / frequencyFromMidi(minMidi)),
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
  const chosen = peaks.find((peak) => (nsdf[peak] ?? 0) >= seuilPic * highest);
  if (chosen === undefined) return null;
  // Le seuil porte sur le pic effectivement retenu, et non sur le plus haut :
  // c'est celui-là qu'on s'apprête à appeler une note, et c'est donc sa
  // périodicité à lui qui doit convaincre.
  if ((nsdf[chosen] ?? 0) < clarteMin) return null;

  // Interpolation parabolique : sans elle, la hauteur est quantifiée par
  // l'échantillonnage, soit près d'un demi-ton dans l'aigu.
  const left = nsdf[chosen - 1] ?? 0;
  const middle = nsdf[chosen] ?? 0;
  const right = nsdf[chosen + 1] ?? 0;
  const divisor = 2 * (2 * middle - left - right);
  const shift = divisor === 0 ? 0 : (right - left) / divisor;

  return { frequency: sampleRate / (chosen + shift), clarity: middle };
}

/** Amplitude de la composante `frequency` d'un segment (Goertzel, fenêtre de Hann). */
function amplitude(segment: Float32Array, sampleRate: number, frequency: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  const n = segment.length;
  for (let i = 0; i < n; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s0 = (segment[i] ?? 0) * hann + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));
}

/**
 * Tranche l'octave par le spectre, là où l'autocorrélation hésite.
 *
 * Une note de fondamentale f a des partiels à f, 2f, 3f… ; la même note une
 * octave plus bas en ajoute à f/2, 3f/2, 5f/2. On regarde donc ces partiels
 * « impairs » : présents sous f, c'est que la vraie note est f/2 (le cas du si
 * grave dont la fondamentale est faible, que l'autocorrélation rend une octave
 * trop haut) ; absents à f, 3f, 5f alors que 2f et 4f sonnent, c'est que la
 * vraie note est 2f (une corde grave qui résonne par sympathie sous un mi).
 */
export function corrigerOctave(
  segment: Float32Array,
  sampleRate: number,
  frequency: number,
  { bas, haut }: { bas: number; haut: number },
  minMidi: number = MIN_MIDI,
): number {
  const A = (f: number): number => (f < sampleRate / 2 ? amplitude(segment, sampleRate, f) : 0);
  const moyenne = (fs: number[]): number => fs.reduce((s, f) => s + A(f), 0) / fs.length;

  const f = frequency;
  if (f / 2 >= frequencyFromMidi(minMidi - 0.5)) {
    const impairsDessous = moyenne([f / 2, (3 * f) / 2, (5 * f) / 2]);
    const partiels = moyenne([f, 2 * f, 3 * f]);
    if (partiels > 0 && impairsDessous / partiels > bas) return f / 2;
  }
  if (2 * f <= frequencyFromMidi(MAX_MIDI)) {
    const impairs = moyenne([f, 3 * f, 5 * f]);
    const pairs = moyenne([2 * f, 4 * f]);
    if (pairs > 0 && impairs / pairs < haut) return 2 * f;
  }
  return f;
}

/**
 * Hauteur retenue parmi plusieurs fenêtres : le demi-ton le plus souvent vu,
 * départagé par la clarté ; sa fréquence est la médiane de ses votes.
 */
function voter(
  trouves: { frequency: number; clarity: number }[],
): { frequency: number; clarity: number } | null {
  if (trouves.length <= 1) return trouves[0] ?? null;
  const parNote = new Map<number, { frequency: number; clarity: number }[]>();
  for (const t of trouves) {
    const midi = Math.round(midiFromFrequency(t.frequency));
    parNote.set(midi, [...(parNote.get(midi) ?? []), t]);
  }
  const score = (groupe: { clarity: number }[]): number =>
    groupe.length + groupe.reduce((somme, t) => somme + t.clarity, 0) / 100;
  const [meilleur] = [...parNote.values()].sort((a, b) => score(b) - score(a));
  if (!meilleur) return null;
  const frequences = meilleur.map((t) => t.frequency).sort((a, b) => a - b);
  return {
    frequency: frequences[Math.floor(frequences.length / 2)] ?? 0,
    clarity: Math.max(...meilleur.map((t) => t.clarity)),
  };
}

function frequencyFromMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
