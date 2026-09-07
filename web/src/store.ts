/** Persistance de la progression dans le `localStorage`.
 *
 * Tout est lu de façon défensive : un stockage absent, désactivé (navigation
 * privée) ou corrompu redonne un état vide plutôt que de casser la page.
 */

import type {
  EclipseIntensity,
  InstrumentId,
  MaskLevel,
  SessionRun,
  Setlist,
  SrsCard,
  StudyMode,
} from './types';
import { isEclipseIntensity, isInstrumentId, isMaskLevel, isStudyMode } from './types';

const STORAGE_KEY = 'choro-srs-v1';

export interface Progress {
  /** Indexé par `${songId}::${instrumentId}`. */
  cards: Record<string, SrsCard>;
  /** Setlists de travail (préparation de concert). */
  setlists: Setlist[];
  /** Setlist active, ou `null` pour travailler tout le répertoire. */
  activeSetlistId: string | null;
  /** Historique des séances menées ; ajout seul, jamais modifié. Plafonné à 200. */
  sessions: SessionRun[];
  /**
   * Horodatage `Date.now()` du dernier enregistrement. Sert d'arbitre à la
   * fusion entre appareils pour les blocs non fusionnables carte par carte
   * (réglages, setlists).
   */
  _rev: number;
  /** Préférences d'interface, mémorisées d'une session à l'autre. */
  settings: {
    blockMinutes: number;
    /** Comment la partition est présentée : voir `StudyMode`. */
    studyMode: StudyMode;
    /** Taux de masquage, utilisé par le seul mode « Mesures cachées ». */
    maskLevel: MaskLevel;
    /**
     * Graine du tirage des mesures masquées. Elle est persistée pour que le
     * motif soit identique d'un chargement à l'autre — on révise les mêmes
     * trous — et n'avance que sur un appui volontaire sur « Mélanger ».
     */
    maskSeed: number;
    /** Réglage du seul mode « Éclipses ». */
    eclipseIntensity: EclipseIntensity;
    /** Position du panneau de réglages, déplacé à la main. */
    panel: { x: number; y: number } | null;
  };
}

const DEFAULT_PROGRESS: Progress = {
  cards: {},
  setlists: [],
  activeSetlistId: null,
  sessions: [],
  _rev: 0,
  settings: {
    blockMinutes: 5,
    studyMode: 'mesures',
    maskLevel: 50,
    maskSeed: 1,
    eclipseIntensity: 'moyennes',
    panel: null,
  },
};

/** Appelé après chaque enregistrement réussi — branché par le module de synchro. */
let afterSave: (progress: Progress) => void = () => {};

export function setAfterSave(hook: (progress: Progress) => void): void {
  afterSave = hook;
}

export function cardKey(songId: string, instrumentId: InstrumentId): string {
  return `${songId}::${instrumentId}`;
}

function isCard(value: unknown): value is SrsCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Partial<SrsCard>;
  return (
    typeof card.ease === 'number' &&
    typeof card.interval === 'number' &&
    typeof card.repetitions === 'number' &&
    typeof card.due === 'string'
  );
}

/** Normalise une entrée de setlist lue du stockage, ou `null` si inexploitable. */
function sanitizeSetlist(value: unknown): Setlist | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.name !== 'string') return null;
  const songIds = Array.isArray(raw.songIds)
    ? raw.songIds.filter((id): id is string => typeof id === 'string')
    : [];
  const asDate = (v: unknown): string | null =>
    typeof v === 'string' && v !== '' ? v : null;
  return {
    id: raw.id,
    name: raw.name,
    songIds,
    from: asDate(raw.from),
    to: asDate(raw.to),
    createdAt: asDate(raw.createdAt) ?? new Date().toISOString(),
  };
}

/** Normalise une séance lue du stockage, ou `null` si inexploitable. */
function sanitizeSessionRun(value: unknown): SessionRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.date !== 'string' || raw.date === '') return null;
  const kind =
    raw.kind === 'deep' || raw.kind === 'urgent' || raw.kind === 'filage'
      ? raw.kind
      : 'urgent';
  return {
    date: raw.date,
    kind,
    instrumentId: isInstrumentId(raw.instrumentId) ? raw.instrumentId : null,
    setlistId: typeof raw.setlistId === 'string' ? raw.setlistId : null,
    setlistName:
      typeof raw.setlistName === 'string' && raw.setlistName !== ''
        ? raw.setlistName
        : 'Tout le répertoire',
    songCount:
      typeof raw.songCount === 'number' && Number.isFinite(raw.songCount)
        ? Math.max(0, Math.round(raw.songCount))
        : 0,
  };
}

export function loadProgress(): Progress {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
  }
  if (!raw) return structuredClone(DEFAULT_PROGRESS);

  try {
    const parsed = JSON.parse(raw) as Partial<Progress>;
    const cards: Record<string, SrsCard> = {};
    for (const [key, value] of Object.entries(parsed.cards ?? {})) {
      if (isCard(value)) {
        cards[key] = { ...value, history: Array.isArray(value.history) ? value.history : [] };
      }
    }
    const stored = (parsed.settings ?? {}) as Record<string, unknown>;
    const settings = { ...DEFAULT_PROGRESS.settings, ...stored };
    // La migration doit consulter les réglages **bruts** : après fusion avec
    // les valeurs par défaut, `studyMode` est toujours renseigné, et l'on ne
    // saurait plus distinguer un réglage ancien d'un réglage courant.
    migrateSettings(settings, stored);

    const setlists = Array.isArray(parsed.setlists)
      ? parsed.setlists
          .map(sanitizeSetlist)
          .filter((entry): entry is Setlist => entry !== null)
      : [];
    const activeSetlistId =
      typeof parsed.activeSetlistId === 'string' &&
      setlists.some((entry) => entry.id === parsed.activeSetlistId)
        ? parsed.activeSetlistId
        : null;
    const rev =
      typeof parsed._rev === 'number' && Number.isFinite(parsed._rev)
        ? parsed._rev
        : 0;

    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
          .map(sanitizeSessionRun)
          .filter((entry): entry is SessionRun => entry !== null)
          .slice(-200)
      : [];

    return { cards, setlists, activeSetlistId, sessions, _rev: rev, settings };
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
  }
}

/**
 * Ramène des réglages enregistrés par une version antérieure dans le modèle
 * courant, et neutralise toute valeur que l'interface ne saurait plus afficher.
 */
function migrateSettings(
  settings: Progress['settings'],
  stored: Record<string, unknown>,
): void {
  if (!isStudyMode(stored.studyMode)) {
    // Le masquage était naguère un simple taux, dont deux valeurs décrivaient
    // en réalité des modes.
    const legacy = stored.maskLevel;
    settings.studyMode =
      legacy === 0 ? 'entiere' : legacy === 'aucune' ? 'sans' : 'mesures';
  }
  if (!isMaskLevel(settings.maskLevel)) {
    // Le palier 80 % des toutes premières versions retombe sur le plus proche.
    settings.maskLevel = settings.maskLevel === (80 as unknown as MaskLevel)
      ? 75
      : DEFAULT_PROGRESS.settings.maskLevel;
  }
  if (!isEclipseIntensity(settings.eclipseIntensity)) {
    settings.eclipseIntensity = DEFAULT_PROGRESS.settings.eclipseIntensity;
  }
  if (typeof settings.maskSeed !== 'number' || !Number.isFinite(settings.maskSeed)) {
    settings.maskSeed = DEFAULT_PROGRESS.settings.maskSeed;
  }
  const panel = settings.panel as { x?: unknown; y?: unknown } | null;
  if (
    !panel ||
    typeof panel.x !== 'number' ||
    typeof panel.y !== 'number' ||
    !Number.isFinite(panel.x) ||
    !Number.isFinite(panel.y)
  ) {
    settings.panel = null;
  }
}

export function saveProgress(progress: Progress): void {
  progress._rev = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Quota plein ou stockage refusé : la session reste utilisable en mémoire.
    console.warn('Progression non enregistrée (localStorage indisponible).');
  }
  afterSave(progress);
}

/**
 * Écrit sans toucher à `_rev` ni notifier la synchro. Réservé au module de
 * synchro lui-même, quand il enregistre le résultat d'une fusion : il ne faut
 * pas qu'un `pull` déclenche aussitôt un `push`.
 */
export function persistMerged(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    console.warn('Progression non enregistrée (localStorage indisponible).');
  }
}

/** Setlist active, ou `null`. */
export function activeSetlist(progress: Progress): Setlist | null {
  if (!progress.activeSetlistId) return null;
  return (
    progress.setlists.find((entry) => entry.id === progress.activeSetlistId) ??
    null
  );
}

/** Crée ou remplace une setlist (identité par `id`), puis enregistre. */
export function upsertSetlist(progress: Progress, setlist: Setlist): void {
  const index = progress.setlists.findIndex((entry) => entry.id === setlist.id);
  if (index === -1) progress.setlists.push(setlist);
  else progress.setlists[index] = setlist;
  saveProgress(progress);
}

/** Supprime une setlist ; si c'était l'active, on repasse sur tout le répertoire. */
export function deleteSetlist(progress: Progress, id: string): void {
  progress.setlists = progress.setlists.filter((entry) => entry.id !== id);
  if (progress.activeSetlistId === id) progress.activeSetlistId = null;
  saveProgress(progress);
}

export function setActiveSetlist(progress: Progress, id: string | null): void {
  progress.activeSetlistId =
    id && progress.setlists.some((entry) => entry.id === id) ? id : null;
  saveProgress(progress);
}

/** Ajoute une séance à l'historique (plafonné à 200), puis enregistre. */
export function recordSession(progress: Progress, run: SessionRun): void {
  progress.sessions.push(run);
  if (progress.sessions.length > 200) {
    progress.sessions = progress.sessions.slice(-200);
  }
  saveProgress(progress);
}

/** La séance la plus récente, ou `undefined`. */
export function lastSession(progress: Progress): SessionRun | undefined {
  return progress.sessions[progress.sessions.length - 1];
}

export function getCard(
  progress: Progress,
  songId: string,
  instrumentId: InstrumentId,
): SrsCard | undefined {
  return progress.cards[cardKey(songId, instrumentId)];
}

export function putCard(
  progress: Progress,
  songId: string,
  instrumentId: InstrumentId,
  card: SrsCard,
): void {
  progress.cards[cardKey(songId, instrumentId)] = card;
  saveProgress(progress);
}
