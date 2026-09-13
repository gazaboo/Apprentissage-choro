/** Chargement du catalogue d'arpèges et de gammes, et dépliage en cartes.
 *
 * Le fichier source est écrit à la main : un motif y figure une seule fois,
 * dans la tonalité où il a été pensé. C'est ici qu'il devient une carte par
 * tonalité et par sens — « Dm7 montant », « Fm7 descendant » — chacune suivie
 * séparément par la répétition espacée, comme le veut le travail instrumental
 * (un arpège su en ré ne l'est pas en sol bémol).
 *
 * La liste `roots` du catalogue est le seul levier de volume : y retirer des
 * tonalités retire autant de cartes. Il n'y a délibérément aucune machinerie
 * de déverrouillage — c'est le fichier qui décide.
 */

import { daysOverdue, statusOf } from '../srs';
import type { Progress } from '../store';
import { getTechniqueCard } from '../store';
import type { SrsCard } from '../types';
import type { NoteSpelling } from './theorie';
import {
  chordRoot,
  formatNote,
  layoutMotif,
  midiOf,
  parseNote,
  transposeChord,
  transposeNote,
} from './theorie';

const CATALOGUE_URL = 'data/technique/exercices.json';

/** Sens de jeu. Une carte par sens : monter et descendre ne s'acquièrent pas ensemble. */
export type Sens = 'montant' | 'descendant' | 'aller-retour';

export const SENS_LABELS: Record<Sens, string> = {
  montant: 'Montant',
  descendant: 'Descendant',
  'aller-retour': 'Aller-retour',
};

function isSens(value: unknown): value is Sens {
  return value === 'montant' || value === 'descendant' || value === 'aller-retour';
}

/** Tonalités engendrées quand le motif n'en précise pas. */
const DEFAULT_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** BPM proposé sur une carte jamais travaillée. */
export const DEFAULT_BPM = 60;

/** Un motif tel qu'il est écrit dans le fichier. */
interface MotifSource {
  id: string;
  famille: string;
  nom: string;
  /** Chiffrage de la tonalité d'écriture, ex. « Dm7 ». */
  reference: string;
  /** Le motif, en noms de notes ; l'octave est facultative. */
  notes: string[];
  /**
   * Notes de la descente, quand elles diffèrent de la montée — le cas des
   * vrais arpèges de choro. Absent, la carte descendante rejoue `notes` à
   * l'envers. Présent, l'octave doit être précisée sur chaque note : la
   * forme n'est pas une simple gamme qui monte, `layoutMotif` ne peut pas la
   * déduire seule.
   */
  notes_descendant?: string[];
  roots?: string[];
  sens?: Sens[];
  note_de_travail?: string;
}

/** Une carte à réviser : un chiffrage, un sens, une suite de hauteurs. */
export interface ExerciceCarte {
  /** « arp-m7-choro::D::montant » — identité stable, sert de clé SRS. */
  id: string;
  motifId: string;
  famille: string;
  nom: string;
  /** Le chiffrage transposé : le seul texte affiché en grand. */
  accord: string;
  sens: Sens;
  /** Noms des notes dans l'ordre de jeu — c'est l'indice. */
  notes: string[];
  /** Hauteurs attendues, dans l'ordre de jeu — c'est ce que le micro compare. */
  midi: number[];
  noteDeTravail: string | null;
}

/**
 * Garde défensive : un catalogue absent ou mal formé masque la section
 * Technique, il ne casse pas l'application.
 */
function isMotifSource(value: unknown): value is MotifSource {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Partial<MotifSource>;
  return (
    typeof raw.id === 'string' &&
    raw.id !== '' &&
    typeof raw.famille === 'string' &&
    typeof raw.nom === 'string' &&
    typeof raw.reference === 'string' &&
    Array.isArray(raw.notes) &&
    raw.notes.length > 0 &&
    raw.notes.every((note) => typeof note === 'string') &&
    (raw.notes_descendant === undefined ||
      (Array.isArray(raw.notes_descendant) &&
        raw.notes_descendant.every((note) => typeof note === 'string')))
  );
}

/** Applique le sens à une suite écrite dans l'ordre ascendant. */
function applySens<T>(values: T[], sens: Sens): T[] {
  if (sens === 'montant') return values;
  if (sens === 'descendant') return [...values].reverse();
  // Aller-retour : on monte, puis on redescend sans rejouer le sommet.
  return [...values, ...[...values].reverse().slice(1)];
}

/** Déplie un motif en une carte par tonalité et par sens. */
function expandMotif(motif: MotifSource): ExerciceCarte[] {
  const from = chordRoot(motif.reference);
  if (!from) return [];

  const parsed = motif.notes
    .map(parseNote)
    .filter((note): note is NoteSpelling => note !== null);
  if (parsed.length !== motif.notes.length) return [];

  const descendantSource = motif.notes_descendant;
  let parsedDescendant: NoteSpelling[] | null = null;
  if (descendantSource) {
    const candidate = descendantSource
      .map(parseNote)
      .filter((note): note is NoteSpelling => note !== null);
    parsedDescendant = candidate.length === descendantSource.length ? candidate : null;
  }

  const roots =
    Array.isArray(motif.roots) && motif.roots.length > 0 ? motif.roots : DEFAULT_ROOTS;
  const senses =
    Array.isArray(motif.sens) && motif.sens.some(isSens)
      ? motif.sens.filter(isSens)
      : (['montant', 'descendant'] as Sens[]);

  const cartes: ExerciceCarte[] = [];

  for (const rootText of roots) {
    const to = parseNote(rootText);
    if (!to) continue;

    const accord = transposeChord(motif.reference, from, to);
    const transposed = parsed.map((note) => transposeNote(note, from, to));
    const names = transposed.map(formatNote);
    const midis = layoutMotif(transposed);

    // La descente d'un arpège choro n'est pas le miroir de la montée : ses
    // notes sont écrites à part, octave comprise, et transposées telles
    // quelles plutôt que redéduites de la montée.
    let descendantNames: string[] | null = null;
    let descendantMidis: number[] | null = null;
    if (parsedDescendant) {
      const transposedDescendant = parsedDescendant.map((note) => transposeNote(note, from, to));
      descendantNames = transposedDescendant.map(formatNote);
      descendantMidis = transposedDescendant.map(midiOf);
    }

    for (const sens of senses) {
      // Aller-retour d'un motif choro : la montée puis la vraie descente,
      // mises bout à bout — pas la montée rejouée en miroir, qui gommerait
      // la forme descendante propre au genre.
      let notes: string[];
      let midi: number[];
      if (sens === 'descendant' && descendantNames && descendantMidis) {
        notes = descendantNames;
        midi = descendantMidis;
      } else if (sens === 'aller-retour' && descendantNames && descendantMidis) {
        notes = [...names, ...descendantNames];
        midi = [...midis, ...descendantMidis];
      } else {
        notes = applySens(names, sens);
        midi = applySens(midis, sens);
      }

      cartes.push({
        id: `${motif.id}::${formatNote(to)}::${sens}`,
        motifId: motif.id,
        famille: motif.famille,
        nom: motif.nom,
        accord,
        sens,
        notes,
        midi,
        noteDeTravail: motif.note_de_travail ?? null,
      });
    }
  }

  return cartes;
}

/**
 * Charge le catalogue et le déplie. Un fichier absent retourne une liste vide
 * — l'appelant masque alors la section plutôt que d'afficher une erreur.
 */
export async function chargerCatalogue(signal: AbortSignal): Promise<ExerciceCarte[]> {
  const response = await fetch(CATALOGUE_URL, { signal });
  if (!response.ok) return [];

  const parsed: unknown = await response.json();
  if (typeof parsed !== 'object' || parsed === null) return [];
  const raw = (parsed as { exercices?: unknown }).exercices;
  if (!Array.isArray(raw)) return [];

  return raw.filter(isMotifSource).flatMap(expandMotif);
}

/**
 * Dernier BPM travaillé sur cette carte, lu dans son historique. On remonte
 * l'historique plutôt que de ne regarder que la dernière entrée : une séance
 * menée sans métronome n'en consigne pas, et effacerait le repère.
 */
export function dernierBpm(card: SrsCard | undefined): number | null {
  if (!card) return null;
  for (let index = card.history.length - 1; index >= 0; index -= 1) {
    const bpm = card.history[index]?.bpm;
    if (typeof bpm === 'number' && Number.isFinite(bpm)) return bpm;
  }
  return null;
}

/** Cartes neuves admises dans une même séance. */
export const NOUVELLES_PAR_SEANCE = 5;

/**
 * Ordre de passage d'une séance : les cartes en retard d'abord, la plus en
 * retard en tête, puis quelques cartes neuves.
 *
 * Le plafond n'est pas cosmétique. `daysOverdue` vaut `+Infinity` pour une
 * carte jamais travaillée : sans lui, les dizaines de cartes engendrées par le
 * catalogue seraient toutes à égalité de priorité maximale, et une première
 * séance ne serait qu'une marche aléatoire sans fin. Les neuves sont prises
 * dans l'ordre du catalogue, non au hasard, pour qu'une famille s'installe
 * avant que la suivante ne commence.
 */
export function pickExercices(
  cartes: ExerciceCarte[],
  progress: Progress,
  maxNouvelles = NOUVELLES_PAR_SEANCE,
): ExerciceCarte[] {
  const dues: { carte: ExerciceCarte; retard: number }[] = [];
  const nouvelles: ExerciceCarte[] = [];

  for (const carte of cartes) {
    const card = getTechniqueCard(progress, carte.id);
    if (statusOf(card) === 'jamais') nouvelles.push(carte);
    else if (daysOverdue(card) >= 0) dues.push({ carte, retard: daysOverdue(card) });
  }

  dues.sort((a, b) => b.retard - a.retard);
  return [...dues.map((entry) => entry.carte), ...nouvelles.slice(0, maxNouvelles)];
}

/** Regroupe les cartes par famille, dans l'ordre d'apparition du catalogue. */
export function parFamille(cartes: ExerciceCarte[]): Map<string, ExerciceCarte[]> {
  const groups = new Map<string, ExerciceCarte[]>();
  for (const carte of cartes) {
    const list = groups.get(carte.famille);
    if (list) list.push(carte);
    else groups.set(carte.famille, [carte]);
  }
  return groups;
}
