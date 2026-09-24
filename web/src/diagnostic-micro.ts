/** Journal de diagnostic du micro : une prise réelle, rejouable hors ligne.
 *
 * La détection a été réglée sur des cordes synthétiques ; sur une vraie
 * guitare elle rate l'essentiel des notes, et relire le code ne dira pas
 * pourquoi. Ce journal garde donc ce que le micro a réellement entendu — le
 * signal **brut**, avant les coupe-bandes du métronome — avec, pour chaque
 * note détectée, l'instant de l'attaque et celui où le résultat est sorti, et
 * l'instant programmé de chaque battue. Le WAV se rejoue ensuite tel quel
 * (`PitchStream` en test, ou Chromium avec `--use-file-for-fake-audio-capture`).
 *
 * Invisible en temps normal : n'apparaît qu'avec `?debug=micro` dans l'URL.
 */

import type { Onset } from './pitch';

/** `?debug=micro` dans l'URL (avant le `#`) active le journal. */
export function diagnosticMicroActif(search: string = window.location.search): boolean {
  return new URLSearchParams(search).getAll('debug').includes('micro');
}

export interface OnsetJournalise extends Onset {
  /** `AudioContext.currentTime` au moment où la note a été rendue. */
  emisA: number;
  /** `performance.now()` au même moment, pour recouper avec l'affichage. */
  emisPerf: number;
}

export interface EnteteJournal {
  sampleRate: number;
  /** `AudioContext.currentTime` du premier échantillon du WAV. */
  debutAudio: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  /** `MediaTrackSettings` du micro, tels que le navigateur les a accordés. */
  reglagesMicro: Record<string, unknown>;
  userAgent: string;
  date: string;
}

export class JournalMicro {
  private morceaux: Float32Array[] = [];
  private longueur = 0;
  private debutFrame: number | null = null;
  private sampleRate = 0;
  private entete: Omit<EnteteJournal, 'debutAudio' | 'sampleRate'> | null = null;
  readonly onsets: OnsetJournalise[] = [];
  readonly battues: { index: number; time: number }[] = [];
  /** Ce que l'appelant juge utile de dater avec la prise (exercice, tempo…). */
  meta: Record<string, unknown> = {};

  /** Appelé par `PitchTracker.start()` une fois le micro ouvert. */
  ouvrir(context: AudioContext, track: MediaStreamTrack | undefined): void {
    this.sampleRate = context.sampleRate;
    this.entete = {
      baseLatency: context.baseLatency ?? null,
      outputLatency: 'outputLatency' in context ? context.outputLatency : null,
      reglagesMicro: { ...(track?.getSettings() ?? {}) },
      userAgent: navigator.userAgent,
      date: new Date().toISOString(),
    };
  }

  /** Un lot brut du worklet, daté en échantillons sur l'horloge du contexte. */
  echantillons(frame: number, samples: Float32Array): void {
    this.debutFrame ??= frame;
    // Un lot perdu laisserait un raccord invisible dans le WAV et décalerait
    // tout ce qui suit : on le comble de silence pour garder l'horloge juste.
    const attendu = this.debutFrame + this.longueur;
    if (frame > attendu) {
      this.morceaux.push(new Float32Array(frame - attendu));
      this.longueur += frame - attendu;
    }
    this.morceaux.push(samples.slice());
    this.longueur += samples.length;
  }

  onset(onset: Onset, context: AudioContext): void {
    this.onsets.push({ ...onset, emisA: context.currentTime, emisPerf: performance.now() });
  }

  battue(index: number, time: number): void {
    this.battues.push({ index, time });
  }

  get duree(): number {
    return this.sampleRate > 0 ? this.longueur / this.sampleRate : 0;
  }

  vide(): boolean {
    return this.longueur === 0;
  }

  /** Le WAV (mono, 16 bits) et le JSON qui le date, prêts à télécharger. */
  exporter(): { wav: ArrayBuffer; json: string } {
    const tout = new Float32Array(this.longueur);
    let at = 0;
    for (const morceau of this.morceaux) {
      tout.set(morceau, at);
      at += morceau.length;
    }
    const entete: EnteteJournal = {
      sampleRate: this.sampleRate,
      debutAudio: this.debutFrame === null ? null : this.debutFrame / this.sampleRate,
      ...(this.entete ?? {
        baseLatency: null,
        outputLatency: null,
        reglagesMicro: {},
        userAgent: '',
        date: new Date().toISOString(),
      }),
    };
    return {
      wav: encodeWav16(tout, this.sampleRate),
      json: JSON.stringify({ ...entete, meta: this.meta, onsets: this.onsets, battues: this.battues }, null, 2),
    };
  }
}

/** Encode un signal mono en WAV PCM 16 bits — le format que Chromium sait
 *  rejouer comme faux micro. */
export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
  }
  return buffer;
}

/** Relit un WAV PCM 16 bits mono ou stéréo (seul le premier canal est gardé). */
export function decodeWav16(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV ${bits} bits non pris en charge`);
      const frames = Math.floor(size / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        samples[i] = view.getInt16(offset + 8 + i * 2 * channels, true) / 0x7fff;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV sans bloc data');
}

/** Déclenche le téléchargement d'un fichier généré dans la page. */
export function telecharger(nom: string, contenu: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
