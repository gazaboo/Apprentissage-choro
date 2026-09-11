/** Lecture MIDI d'une séquence de notes, pour entendre un arpège ou une gamme
 * à la hauteur et au tempo exacts de l'exercice.
 *
 * Même procédé de programmation à l'avance que `metronome.ts` : un réveil
 * fréquent mais imprécis qui planifie les notes tombant dans la fenêtre
 * suivante à des instants `AudioContext.currentTime` exacts, plutôt que de
 * chaîner des `setTimeout` qui dériveraient sur une gamme de sept ou huit
 * notes.
 *
 * Le son est synthétisé, comme le clic du métronome : le projet n'embarque
 * aucun échantillon, et une onde triangulaire suffit à identifier une
 * hauteur sans laisser croire qu'il s'agit d'un instrument de référence.
 */

import { frequencyOf } from './technique/theorie';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;

/** Durée de l'enveloppe d'une note. Assez longue pour s'entendre, assez
 * brève pour ne jamais chevaucher la suivante à 240 BPM (0,25 s l'écart). */
const NOTE_S = 0.22;

export interface SequencePlayerOptions {
  /** Appelé au moment de la **programmation**, avec l'instant audio visé. */
  onNote: (index: number, audioTime: number) => void;
  /** Appelé une fois la dernière note jouée éteinte, hors lecture en boucle. */
  onDone: () => void;
}

export class SequencePlayer {
  private readonly context: AudioContext;
  private readonly onNote: (index: number, audioTime: number) => void;
  private readonly onDone: () => void;
  private timer: number | null = null;
  /** Réveil de fin, pendant la fenêtre où la dernière note sonne encore. */
  private pendingDone: number | null = null;
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
  start(midi: number[], bpm: number, loop: boolean): void {
    this.stop();
    if (midi.length === 0) return;

    this.midi = midi;
    this.bpm = bpm;
    this.loop = loop;
    this.index = 0;
    // Le même court délai que le métronome : sans lui, la première note
    // tombe dans le passé et n'est jamais jouée.
    this.nextNoteTime = this.context.currentTime + 0.15;
    this.lastNoteTime = this.nextNoteTime;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pendingDone !== null) {
      window.clearTimeout(this.pendingDone);
      this.pendingDone = null;
    }
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
      this.pluck(midiNote, this.nextNoteTime);
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
    const doneAt = this.lastNoteTime + NOTE_S;
    this.stop();
    const delay = Math.max(0, doneAt - this.context.currentTime) * 1000;
    this.pendingDone = window.setTimeout(() => {
      this.pendingDone = null;
      this.onDone();
    }, delay);
  }

  private pluck(midi: number, at: number): void {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.value = frequencyOf(midi);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S);

    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_S + 0.02);
  }
}
