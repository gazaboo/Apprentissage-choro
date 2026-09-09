/** Formes de données produites par `scripts/preprocess_all.py`. */

export type InstrumentId = 'c' | 'bb' | 'eb';

export function isInstrumentId(value: unknown): value is InstrumentId {
  return value === 'c' || value === 'bb' || value === 'eb';
}

/** Libellés des transpositions pour les intitulés de filage. */
export const INSTRUMENT_SHORT_LABELS: Record<InstrumentId, string> = {
  c: 'accompagnateur',
  bb: 'Si♭',
  eb: 'Mi♭',
};

/** Libellés « tonalité » pour le choix de partition (écran de préparation du filage). */
export const INSTRUMENT_KEY_LABELS: Record<InstrumentId, string> = {
  c: 'Ut / C',
  bb: 'Si♭ / B♭',
  eb: 'Mi♭ / E♭',
};

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

/** Comment la zone d'étude est présentée : partition en portée ou grille d'accords. */
export type DisplayMode = 'partition' | 'grille';

export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'partition' || value === 'grille';
}

/**
 * Une cellule de grille : les accords joués pendant une mesure écrite.
 * `[]` = on tient l'accord précédent ; `['Dm']` = un accord ; `['A7', 'D7']` =
 * mesure partagée entre plusieurs accords.
 */
export type GrilleCell = string[];

export interface GrillePart {
  /** « A », « B », « Intro »… */
  name: string;
  /** Centre tonal de la partie, à titre indicatif. */
  tonic?: string;
  /** Plage de mesures dans la partition, ex. « 1–32 ». */
  bars?: string;
  repeat?: boolean;
  /** Une entrée par mesure écrite. */
  sequence: GrilleCell[];
  /** 1re / 2e fin, quand la partie en porte. */
  endings?: { '1'?: GrilleCell[]; '2'?: GrilleCell[] };
  /** Coda propre à la partie (rare). */
  coda?: GrilleCell[];
  /** Mesures d'enchaînement précédant la partie (rare). */
  transition_in?: GrilleCell[];
}

/**
 * Grille d'accords d'un morceau, transcrite à la vue (transposition Ut/C).
 * Un fichier par morceau : `data/grilles/<song-id>.json`.
 */
export interface Grille {
  song_id: string;
  title: string;
  composer: string;
  meter?: string;
  genre?: string;
  form?: string;
  parts: GrillePart[];
  /** Coda du morceau, jouée après la dernière partie. */
  coda?: GrilleCell[];
  coda_note?: string;
  notes?: string[];
  confidence?: 'high' | 'medium' | 'low';
}

function isCellArray(value: unknown): value is GrilleCell[] {
  return (
    Array.isArray(value) &&
    value.every(
      (cell) => Array.isArray(cell) && cell.every((chord) => typeof chord === 'string'),
    )
  );
}

/** Garde défensive : un fichier grille absent ou mal formé ne casse pas l'écran. */
export function isGrille(value: unknown): value is Grille {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Partial<Grille>;
  if (typeof raw.song_id !== 'string' || typeof raw.title !== 'string') return false;
  if (!Array.isArray(raw.parts) || raw.parts.length === 0) return false;
  return raw.parts.every(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      typeof (part as GrillePart).name === 'string' &&
      isCellArray((part as GrillePart).sequence),
  );
}

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

/**
 * Sélection de morceaux à travailler sur une période — typiquement la
 * préparation d'un concert. Les dates sont purement indicatives : elles
 * n'activent ni ne désactivent rien, c'est un choix qu'on pose à la main.
 */
export interface Setlist {
  id: string;
  name: string;
  /** Références `Song.id` ; un id absent du manifeste est toléré et affiché grisé. */
  songIds: string[];
  /** Date ISO de création, pour trier la liste. */
  createdAt: string;
}

/**
 * Mode d'une séance :
 * - `'deep'`   : toute la setlist dans l'ordre SRS, sans minuteur ;
 * - `'urgent'` : les 3 plus en retard, entrelacé (blocs de 5 min) ;
 * - `'filage'` : la setlist dans l'ordre, enchaînée avec l'audio, décompte de
 *   5 s entre les morceaux — comme un filage de concert.
 */
export type SessionKind = 'deep' | 'urgent' | 'filage';

/** Une séance de travail menée à son terme (ou interrompue). */
export interface SessionRun {
  /** Date ISO complète — sert aussi d'identifiant à la fusion entre appareils. */
  date: string;
  kind: SessionKind;
  /** Transposition travaillée — renseigné pour un filage, `null` sinon. */
  instrumentId: InstrumentId | null;
  setlistId: string | null;
  /** Nom de la setlist, ou « Tout le répertoire » quand `setlistId` est `null`. */
  setlistName: string;
  /** Nombre de morceaux distincts effectivement travaillés (ou enchaînés). */
  songCount: number;
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
