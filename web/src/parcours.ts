/** Parcours d'un morceau : ses dernières séances, avec ou sans partition.
 *
 * L'appli alterne d'elle-même partition entière et jeu par cœur
 * (`recommendedMode`) ; le parcours rend cette alternance visible dans la
 * liste du répertoire, une case par séance, les plus récentes à droite. Sa
 * longueur est plafonnée : au-delà de quelques cases, une rangée par séance
 * déborderait de la ligne sur mobile.
 */

import { PASSING_GRADE } from './srs';
import type { SrsCard, SrsReview } from './types';

export type ParcoursCase =
  /** Partition entière sous les yeux. */
  | 'partition'
  /** Mesures cachées ou éclipses : partition partiellement masquée. */
  | 'partiel'
  | 'par-coeur'
  | 'par-coeur-rate'
  /** Révision antérieure à l'enregistrement du mode. */
  | 'inconnu';

/** Nombre de séances montrées dans la liste. */
export const PARCOURS_LONGUEUR = 8;

export function parcoursCase(review: SrsReview): ParcoursCase {
  switch (review.mode) {
    case 'entiere':
      return 'partition';
    case 'mesures':
    case 'eclipses':
      return 'partiel';
    case 'sans':
      return review.grade >= PASSING_GRADE ? 'par-coeur' : 'par-coeur-rate';
    default:
      return 'inconnu';
  }
}

/**
 * Dernières séances d'un morceau, toutes transpositions confondues : on
 * travaille un morceau, pas une tonalité, et changer d'instrument ne doit pas
 * effacer le chemin parcouru. Le tri par date est stable, donc deux
 * révisions du même jour gardent l'ordre de leur carte.
 */
export function parcours(
  cards: Array<SrsCard | undefined>,
  longueur = PARCOURS_LONGUEUR,
): ParcoursCase[] {
  const reviews = cards
    .flatMap((card) => card?.history ?? [])
    .sort((a, b) => a.date.localeCompare(b.date));
  return reviews.slice(-longueur).map(parcoursCase);
}
