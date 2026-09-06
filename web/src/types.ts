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
 * Comment la partition est présentée pendant le travail.
 *
 * Les quatre modes forment une échelle de difficulté, et non un empilement
 * d'options : on choisit à quel point on s'appuie sur le papier.
 */
export type StudyMode = 'entiere' | 'mesures' | 'eclipses' | 'sans';

export const STUDY_MODES: StudyMode[] = ['entiere', 'mesures', 'eclipses', 'sans'];

export const STUDY_MODE_LABELS: Record<StudyMode, string> = {
  entiere: 'Partition entière',
  mesures: 'Mesures cachées',
  eclipses: 'Éclipses',
  sans: 'Sans partition',
};

export const STUDY_MODE_HINTS: Record<StudyMode, string> = {
  entiere: 'Rien n’est caché : lecture et repérage.',
  mesures: 'Des mesures sont recouvertes. Touchez-en une pour la revoir 5 s.',
  eclipses: 'La partition disparaît par surprise. Continuez à jouer.',
  sans: 'Aucune partition : à l’oreille et de mémoire.',
};

/** Proportion de mesures recouvertes, en mode « Mesures cachées ». */
export type MaskLevel = 25 | 50 | 75;

export const MASK_LEVELS: MaskLevel[] = [25, 50, 75];

/** Fréquence et durée des éclipses, réglées d'un seul geste. */
export type EclipseIntensity = 'douces' | 'moyennes' | 'intenses';

export const ECLIPSE_INTENSITIES: EclipseIntensity[] = ['douces', 'moyennes', 'intenses'];

export const ECLIPSE_LABELS: Record<EclipseIntensity, string> = {
  douces: 'Douces',
  moyennes: 'Moyennes',
  intenses: 'Intenses',
};

export function isStudyMode(value: unknown): value is StudyMode {
  return (STUDY_MODES as unknown[]).includes(value);
}

export function isMaskLevel(value: unknown): value is MaskLevel {
  return (MASK_LEVELS as unknown[]).includes(value);
}

export function isEclipseIntensity(value: unknown): value is EclipseIntensity {
  return (ECLIPSE_INTENSITIES as unknown[]).includes(value);
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
