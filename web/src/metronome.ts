/** Métronome Web Audio, pour le travail des arpèges et gammes.
 *
 * Les horloges du reste de l'application (`audio.ts`, `eclipse.ts`) sont des
 * `setInterval` à 100 ms : suffisant pour repeindre un compteur, inutilisable
 * pour un clic. `setTimeout` dérive de plusieurs dizaines de millisecondes sous
 * charge, et l'irrégularité s'entend immédiatement.
 *
 * On applique donc le procédé habituel : un réveil fréquent mais imprécis qui
 * se contente de **programmer à l'avance** les clics tombant dans la fenêtre
 * suivante, à des instants `AudioContext.currentTime` exacts. C'est le matériel
 * audio qui tient le tempo, pas le fil d'exécution JavaScript.
 *
 * `onBeat` publie l'instant audio de chaque battue. C'est ce qui permet au
 * reste de l'écran — surlignage de la note courante, notation de ce qui est
 * joué — de se caler sur la même horloge que le clic, et non sur `Date.now()`.
 */

/** Cadence du réveil : assez court pour ne jamais rater la fenêtre. */
const TICK_MS = 25;

/** Portée de programmation : on remplit toujours les 100 ms à venir. */
const LOOKAHEAD_S = 0.1;

/** Durée d'un clic. Très bref : il doit marquer, pas sonner. */
const CLICK_S = 0.03;

export const MIN_BPM = 30;
export const MAX_BPM = 240;

export interface MetronomeOptions {
  /** Appelé au moment de la **programmation**, avec l'instant audio visé. */
  onBeat: (index: number, audioTime: number) => void;
  /** Nombre de battues entre deux accents. `0` désactive l'accent. */
  accentEvery?: number;
}

export class Metronome {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private bpm = 60;
  private nextBeatTime = 0;
  private beatIndex = 0;
  private readonly onBeat: (index: number, audioTime: number) => void;
  private accentEvery: number;

  constructor(options: MetronomeOptions) {
    this.onBeat = options.onBeat;
    this.accentEvery = options.accentEvery ?? 0;
  }

  /**
   * L'`AudioContext` n'est créé qu'ici : les navigateurs refusent de le
   * démarrer hors d'un geste de l'utilisateur, et en créer un au chargement
   * laisserait un contexte suspendu pour rien.
   *
   * `countIn` fait démarrer `beatIndex` en négatif : ces battues de
   * préparation passent par le même `onBeat`, sur la même horloge, pour que
   * le compteur affiché à l'écran ne puisse pas dériver du clic qu'on
   * entend.
   */
  async start(bpm: number, accentEvery?: number, countIn = 0): Promise<void> {
    this.stop();
    this.bpm = clampBpm(bpm);
    if (accentEvery !== undefined) this.accentEvery = accentEvery;

    const context = this.ensureContext();
    if (context.state === 'suspended') await context.resume();

    this.beatIndex = -Math.max(0, Math.round(countIn));
    // Un court délai avant la première battue : sans lui, le premier clic
    // tombe dans le passé et n'est jamais joué.
    this.nextBeatTime = context.currentTime + 0.15;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /**
   * Ouvre le contexte audio sans lancer le clic. La captation micro en a
   * besoin — elle doit lire la même horloge que le métronome — et peut être
   * activée avant lui.
   */
  async prepare(): Promise<AudioContext> {
    const context = this.ensureContext();
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Le tempo change à la battue suivante ; les clics déjà programmés tiennent. */
  setBpm(bpm: number): void {
    this.bpm = clampBpm(bpm);
  }

  setAccentEvery(beats: number): void {
    this.accentEvery = Math.max(0, Math.round(beats));
  }

  /** Horloge partagée : la captation micro doit lire les mêmes instants. */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  destroy(): void {
    this.stop();
    void this.context?.close().catch(() => {
      /* contexte déjà fermé : sans conséquence */
    });
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
    }
    return this.context;
  }

  private schedule(): void {
    const context = this.context;
    if (!context) return;
    const horizon = context.currentTime + LOOKAHEAD_S;

    // `this.timer !== null` relit l'état à chaque tour : `onBeat` a le droit
    // d'appeler `stop()` — la fin d'une évaluation le fait, pour ne pas
    // programmer une battue de plus que demandé — et la programmation doit
    // alors cesser immédiatement, sans dépendre du fait qu'une battue soit
    // plus longue que l'horizon (vrai jusqu'à 240 BPM, mais accidentel).
    while (this.timer !== null && this.nextBeatTime < horizon) {
      const countIn = this.beatIndex < 0;
      const accented =
        !countIn && this.accentEvery > 0 && this.beatIndex % this.accentEvery === 0;
      this.click(context, this.nextBeatTime, accented, countIn);
      this.onBeat(this.beatIndex, this.nextBeatTime);

      this.beatIndex += 1;
      this.nextBeatTime += 60 / this.bpm;
    }
  }

  /**
   * Le clic est synthétisé plutôt que chargé : un fichier de plus à servir
   * pour deux sinusoïdes n'en vaut pas la peine. L'enveloppe évite le claquement
   * qu'un simple `stop()` produirait sur une oscillation tronquée.
   *
   * Le clic de préparation a son propre timbre (le plus grave des trois) :
   * il doit s'entendre comme un décompte, jamais se confondre avec l'accent
   * de motif qui marque le début d'une passe réelle.
   */
  private click(context: AudioContext, at: number, accented: boolean, countIn = false): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.frequency.value = countIn ? 600 : accented ? 1000 : 800;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accented || countIn ? 0.5 : 0.3, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_S);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + CLICK_S + 0.01);
  }
}

/**
 * Passe en cours à cette battue, ou `null` pendant le décompte de
 * préparation (`beatIndex` négatif) — c'est-à-dire avant que la première
 * note du motif n'ait été jouée.
 *
 * `cycleLength` est la longueur d'un passage complet du motif, en battues —
 * la même valeur que `accentEvery` transmis à `Metronome.start()`.
 */
export function cycleOf(beatIndex: number, cycleLength: number): number | null {
  if (beatIndex < 0 || cycleLength <= 0) return null;
  return Math.floor(beatIndex / cycleLength);
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 60;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}
