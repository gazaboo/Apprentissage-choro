/** Persistance de la progression dans le `localStorage`.
 *
 * Tout est lu de façon défensive : un stockage absent, désactivé (navigation
 * privée) ou corrompu redonne un état vide plutôt que de casser la page.
 */

import type {
  EclipseIntensity,
  InstrumentId,
  MaskLevel,
  SrsCard,
  StudyMode,
} from './types';
import { isEclipseIntensity, isMaskLevel, isStudyMode } from './types';

const STORAGE_KEY = 'choro-srs-v1';

export interface Progress {
  /** Indexé par `${songId}::${instrumentId}`. */
  cards: Record<string, SrsCard>;
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
  settings: {
    blockMinutes: 5,
    studyMode: 'mesures',
    maskLevel: 50,
    maskSeed: 1,
    eclipseIntensity: 'moyennes',
    panel: null,
  },
};

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
    return { cards, settings };
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Quota plein ou stockage refusé : la session reste utilisable en mémoire.
    console.warn('Progression non enregistrée (localStorage indisponible).');
  }
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
