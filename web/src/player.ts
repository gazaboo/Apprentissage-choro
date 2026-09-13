/** Lecture d'une séquence de notes, pour entendre un arpège ou une gamme à la
 * hauteur et au tempo exacts de l'exercice.
 *
 * Même procédé de programmation à l'avance que `metronome.ts` : un réveil
 * fréquent mais imprécis qui planifie les notes tombant dans la fenêtre
 * suivante à des instants `AudioContext.currentTime` exacts, plutôt que de
 * chaîner des `setTimeout` qui dériveraient sur une gamme de sept ou huit
 * notes.
 *
 * Le son est un vrai piano échantillonné (`technique/piano.ts`) — une
 * synthèse maison (oscillateur, puis Karplus-Strong) a été essayée et jugée
 * trop artificielle. Chaque note est tenue jusqu'au début de la suivante
 * (« noire après noire »), pas une decay courte : c'est `holdUntil` dans
 * `playNote` qui porte ce phrasé lié.
 */

import { loadPianoSamples, sampleFor } from './technique/piano';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;

/** Montée en volume au début d'une note : assez courte pour ne pas retarder
 * l'attaque perçue, assez longue pour ne jamais cliquer. */
const ATTACK_S = 0.005;
/** Redescente à zéro juste avant la note suivante : le phrasé lié vient de
 * la tenir jusque-là, pas de cette rampe, volontairement brève. */
const RELEASE_S = 0.03;
/** Fondu forcé quand l'utilisateur arrête l'écoute en plein milieu d'une
 * note tenue — sans quoi elle sonnerait jusqu'à une seconde de plus. */
const STOP_FADE_S = 0.018;
/** Niveau de soutien d'une note : pas 1, pour laisser de la marge pendant le
 * bref chevauchement avec la fin de la précédente. */
const SUSTAIN_LEVEL = 0.7;

export interface SequencePlayerOptions {
  /** Appelé au moment de la **programmation**, avec l'instant audio visé. */
  onNote: (index: number, audioTime: number) => void;
  /** Appelé une fois la dernière note jouée éteinte, hors lecture en boucle. */
  onDone: () => void;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class SequencePlayer {
  private readonly context: AudioContext;
  private readonly onNote: (index: number, audioTime: number) => void;
  private readonly onDone: () => void;
  private timer: number | null = null;
  /** Réveil de fin, pendant la fenêtre où la dernière note sonne encore. */
  private pendingDone: number | null = null;
  private buffers: Map<number, AudioBuffer> | null = null;
  /** Dernière voix déclenchée, pour pouvoir la couper sur un arrêt utilisateur. */
  private activeVoice: Voice | null = null;
  private midi: number[] = [];
  private bpm = 60;
  private loop = false;
  private nextNoteTime = 0;
  private lastNoteTime = 0;
  private index = 0;

  constructor(context: AudioContext, options: SequencePlayerOptions) {
    this.context = context;
    this.onNote = options.onNote;
    this.onDone = options.onDone;
  }

  /** Joue `midi` une note à la fois, au tempo `bpm`. */
  async start(midi: number[], bpm: number, loop: boolean): Promise<void> {
    this.stop(false);
    if (midi.length === 0) return;

    // Le décodage des échantillons (premier appel seulement, ensuite mis en
    // cache) peut prendre le temps de quelques images : recalculer l'instant
    // de départ après l'attente, pas avant, sinon la première note tombe
    // dans le passé.
    this.buffers = await loadPianoSamples(this.context);

    this.midi = midi;
    this.bpm = bpm;
    this.loop = loop;
    this.index = 0;
    this.nextNoteTime = this.context.currentTime + 0.15;
    this.lastNoteTime = this.nextNoteTime;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /**
   * `userInitiated` distingue un arrêt demandé (clic sur « Arrêter
   * l'écoute », changement d'écran, exclusion mutuelle avec le métronome) —
   * qui doit couper la note en train de sonner tout de suite — d'un arrêt
   * interne (redémarrage depuis `start()`, fin normale de séquence depuis
   * `finish()`) où la voix en cours a déjà sa propre extinction programmée
   * et ne doit pas être coupée une seconde fois.
   */
  stop(userInitiated = true): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pendingDone !== null) {
      window.clearTimeout(this.pendingDone);
      this.pendingDone = null;
    }
    if (userInitiated && this.activeVoice) {
      const { source, gain } = this.activeVoice;
      const now = this.context.currentTime;
      // Annuler l'automation programmée (tenue/relâchement) avant d'en poser
      // une nouvelle : sinon les deux se disputent la valeur et ça clique.
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_S);
      source.stop(now + STOP_FADE_S + 0.01);
    }
    this.activeVoice = null;
  }

  /**
   * Vrai tant que la dernière note programmée n'est pas éteinte, pas
   * seulement tant que le réveil de programmation tourne : sans quoi un
   * appui sur « Écouter » dans la fenêtre entre la dernière note et
   * `onDone` relancerait la lecture au lieu de l'arrêter.
   */
  get playing(): boolean {
    return this.timer !== null || this.pendingDone !== null;
  }

  private schedule(): void {
    const horizon = this.context.currentTime + LOOKAHEAD_S;

    while (this.index < this.midi.length && this.nextNoteTime < horizon) {
      const midiNote = this.midi[this.index]!;
      this.playNote(midiNote, this.nextNoteTime);
      this.onNote(this.index, this.nextNoteTime);

      this.lastNoteTime = this.nextNoteTime;
      this.index += 1;
      this.nextNoteTime += 60 / this.bpm;

      if (this.index >= this.midi.length) {
        if (!this.loop) {
          this.finish();
          return;
        }
        this.index = 0;
      }
    }
  }

  /** Arrête le réveil de programmation, mais attend que la dernière note
   * s'éteigne avant de prévenir l'écran : couper là gèlerait le surlignage
   * une fraction de seconde avant que le son ne s'arrête vraiment. */
  private finish(): void {
    const doneAt = this.lastNoteTime + 60 / this.bpm;
    this.stop(false);
    const delay = Math.max(0, doneAt - this.context.currentTime) * 1000;
    this.pendingDone = window.setTimeout(() => {
      this.pendingDone = null;
      this.onDone();
    }, delay);
  }

  /**
   * Joue `midi` à l'instant `at` et la tient jusqu'au début de la note
   * suivante (`at + 60/bpm`, appelé `holdUntil` ci-dessous) — le phrasé lié
   * demandé, plutôt qu'une decay courte. `activeVoice` retient la voix pour
   * qu'un arrêt utilisateur puisse la couper avant cette échéance naturelle.
   */
  private playNote(midi: number, at: number): void {
    const { buffer, playbackRate } = sampleFor(midi, this.buffers!);
    const holdUntil = at + 60 / this.bpm;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(SUSTAIN_LEVEL, at + ATTACK_S);
    gain.gain.setValueAtTime(SUSTAIN_LEVEL, holdUntil - RELEASE_S);
    gain.gain.linearRampToValueAtTime(0, holdUntil);

    source.connect(gain).connect(this.context.destination);
    source.start(at);
    source.stop(holdUntil + 0.02);

    this.activeVoice = { source, gain };
  }
}
