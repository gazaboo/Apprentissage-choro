/** Formes de données produites par `scripts/preprocess_all.py`. */

export type InstrumentId = 'c' | 'bb' | 'eb';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Measure {
  id: string;
  box: Box;
}

export interface Page {
  page_number: number;
  image_path: string;
  measures_source: 'vector' | 'raster';
  measures: Measure[];
}

export interface Instrument {
  id: InstrumentId;
  name: string;
  page_count: number;
  measure_count: number;
  pages: Page[];
}

export interface AudioSource {
  url: string;
  youtube_id: string;
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  audio: {
    /** `null` quand `url.md` est absent ou vide — l'UI doit le tolérer. */
    reference: AudioSource | null;
    playback: AudioSource | null;
  };
  instruments: Instrument[];
}

/** Quelle source audio le lecteur joue actuellement. */
export type AudioKind = 'reference' | 'playback';

/** Aisance technique déclarée à la fin d'un morceau. */
export type Tempo = 'sous-tempo' | 'crispe' | 'fluide';

/**
 * Niveau de masquage de la partition à trous.
 *
 * `'aucune'` n'est pas un taux : la partition disparaît entièrement, et le
 * morceau se travaille à l'oreille et de mémoire seules.
 */
export type MaskLevel = 0 | 25 | 50 | 75 | 'aucune';

/** Les paliers dans l'ordre d'affichage, du plus lisible au plus exigeant. */
export const MASK_LEVELS: MaskLevel[] = [0, 25, 50, 75, 'aucune'];

export const MASK_LEVEL_LABELS: Record<string, string> = {
  '0': 'Aucun',
  '25': '25 %',
  '50': '50 %',
  '75': '75 %',
  aucune: 'Sans partition',
};

export function isMaskLevel(value: unknown): value is MaskLevel {
  return (MASK_LEVELS as unknown[]).includes(value);
}

export interface SrsReview {
  date: string;
  grade: number;
  tempo: Tempo;
  hints: number;
}

export interface SrsCard {
  ease: number;
  interval: number;
  repetitions: number;
  /** Date ISO (AAAA-MM-JJ) de la prochaine révision. */
  due: string;
  history: SrsReview[];
}
