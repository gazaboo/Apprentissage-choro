/** Persistance de la progression dans le `localStorage`.
 *
 * Tout est lu de façon défensive : un stockage absent, désactivé (navigation
 * privée) ou corrompu redonne un état vide plutôt que de casser la page.
 */

import type { InstrumentId, SrsCard } from './types';

const STORAGE_KEY = 'choro-srs-v1';

export interface Progress {
  /** Indexé par `${songId}::${instrumentId}`. */
  cards: Record<string, SrsCard>;
  /** Préférences d'interface, mémorisées d'une session à l'autre. */
  settings: {
    blockMinutes: number;
    maskLevel: number;
  };
}

const DEFAULT_PROGRESS: Progress = {
  cards: {},
  settings: { blockMinutes: 5, maskLevel: 50 },
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
    return {
      cards,
      settings: { ...DEFAULT_PROGRESS.settings, ...(parsed.settings ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_PROGRESS);
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
