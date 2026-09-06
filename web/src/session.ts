/** Session du jour entrelacée (*interleaving*).
 *
 * L'entrelacement est le principe actif : au lieu de travailler un morceau en
 * bloc jusqu'à ce qu'il « rentre », on impose un retour périodique sur une
 * autre pièce. Chaque retour force une récupération en mémoire plutôt qu'un
 * simple maintien en mémoire de travail — plus coûteux sur le moment, bien
 * plus durable ensuite.
 */

import { daysOverdue } from './srs';
import type { Progress } from './store';
import { getCard } from './store';
import type { InstrumentId, Song } from './types';

/** Un morceau retenu pour la session, avec l'instrument à travailler. */
export interface SessionItem {
  song: Song;
  instrumentId: InstrumentId;
}

export interface SessionBlock {
  item: SessionItem;
  /** Rang du bloc, à partir de 1. */
  index: number;
}

/** Instrument par défaut : celui déjà travaillé, sinon le premier disponible. */
function preferredInstrument(song: Song, progress: Progress): InstrumentId {
  const studied = song.instruments.find((instrument) =>
    getCard(progress, song.id, instrument.id),
  );
  return (studied ?? song.instruments[0]!).id;
}

/**
 * Sélectionne les morceaux prioritaires : jamais travaillés d'abord, puis les
 * plus en retard. `count` vaut 2 ou 3 — au-delà, la rotation devient trop
 * diluée pour que chaque retour soit un vrai rappel.
 */
export function pickSessionItems(
  songs: Song[],
  progress: Progress,
  count: number,
): SessionItem[] {
  const scored = songs
    .filter((song) => song.instruments.length > 0)
    .map((song) => {
      const instrumentId = preferredInstrument(song, progress);
      const overdue = daysOverdue(getCard(progress, song.id, instrumentId));
      return { song, instrumentId, overdue };
    })
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return b.overdue - a.overdue;
      // Départage stable mais non alphabétique, pour varier les sessions.
      return Math.random() - 0.5;
    });

  return scored
    .slice(0, Math.max(1, Math.min(count, scored.length)))
    .map(({ song, instrumentId }) => ({ song, instrumentId }));
}

/**
 * Construit la rotation alternée : A, B, A, B… (ou A, B, C, A, B, C).
 * Deux tours complets, soit 4 blocs à deux morceaux et 6 à trois.
 */
export function buildRotation(items: SessionItem[]): SessionBlock[] {
  const rounds = 2;
  const blocks: SessionBlock[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const item of items) {
      blocks.push({ item, index: blocks.length + 1 });
    }
  }
  return blocks;
}

/** Minuteur d'un bloc, avec compte à rebours visible et fin automatique. */
export class BlockTimer {
  private intervalId: number | null = null;
  private endsAt = 0;

  constructor(
    private readonly onTick: (secondsLeft: number) => void,
    private readonly onDone: () => void,
  ) {}

  start(minutes: number): void {
    this.stop();
    this.endsAt = Date.now() + minutes * 60_000;
    this.onTick(this.secondsLeft());
    this.intervalId = window.setInterval(() => {
      const left = this.secondsLeft();
      this.onTick(left);
      if (left <= 0) {
        this.stop();
        this.onDone();
      }
    }, 1000);
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
