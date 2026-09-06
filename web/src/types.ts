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

/** Niveau de masquage de la partition à trous. */
export type MaskLevel = 25 | 50 | 80;

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
