/** Mise en page d'un motif sur une portée, sans rien dessiner.
 *
 * Tout est calculé ici, en **unités de portée** (un interligne = 10), puis
 * dessiné tel quel par `views/portee.ts` dans un SVG dont le `viewBox` épouse
 * ces unités. La portée se met ensuite à l'échelle d'un bloc : un écart entre
 * notes, une altération, une hampe gardent les mêmes proportions sur un
 * téléphone de 320 px comme sur un écran large. Rien ne peut se tasser ni
 * déborder à une largeur donnée, puisque rien ne dépend de la largeur.
 *
 * ## Clé de sol octaviée
 *
 * Le catalogue place ses motifs dans la tessiture de la guitare (plancher mi
 * grave, MIDI 40, voir `layoutMotif`). On les écrit donc comme une partition
 * de guitare : clé de sol avec un « 8 » dessous, une octave au-dessus du son
 * réel. Le mi grave tombe ainsi trois lignes supplémentaires sous la portée,
 * là où tout guitariste l'attend.
 *
 * ## Espacement
 *
 * Un pas constant entre les têtes de note, et non un pas qui s'allonge devant
 * une altération : les notes sont de même durée, la régularité du dessin dit
 * la régularité du rythme. Le pas est choisi pour loger la plus large des
 * altérations (le double bémol) entre deux têtes, avec du jeu de part et
 * d'autre — c'est ce que vérifie `portee.unit.test.ts` sur tout le catalogue.
 */

import { parseNote } from './theorie';

/** Un interligne. Toutes les autres mesures en découlent. */
export const INTERLIGNE = 10;

/** Demi-largeur d'une tête de note. */
export const TETE_DEMI_LARGEUR = 6.4;

/** Longueur d'une hampe : trois interlignes et demi, l'usage de la gravure. */
export const HAMPE = 35;

/** Pas entre deux têtes consécutives. */
export const PAS = 36;

/** Espace ajouté entre la montée et la descente d'un aller-retour. */
export const SEPARATION = 14;

/** Bord gauche et largeur de la clé. */
export const CLE_X = 6;
export const CLE_LARGEUR = 31;

/** Place laissée entre la clé et la première note (altération comprise). */
const APRES_CLE = 14;
/** Débord de la portée après la dernière tête. */
const FIN = 16;
/** Jeu entre une altération et la tête qu'elle précède. */
const JEU_ALTERATION = 3.5;

/** Débord d'une ligne supplémentaire de part et d'autre de la tête. */
export const DEBORD_LIGNE_SUPPLEMENTAIRE = 3;

/** Largeur dessinée de chaque altération, de −2 (double bémol) à +2. */
export const LARGEUR_ALTERATION: Record<number, number> = {
  [-2]: 13,
  [-1]: 7.5,
  0: 0,
  1: 9,
  2: 9,
};

/** Étendue verticale d'une altération autour de la hauteur de sa note. */
export const HAUTEUR_ALTERATION: Record<number, { haut: number; bas: number }> = {
  [-2]: { haut: 17, bas: 6 },
  [-1]: { haut: 17, bas: 6 },
  0: { haut: 0, bas: 0 },
  1: { haut: 14, bas: 14 },
  2: { haut: 5, bas: 5 },
};

/** La clé déborde de la portée de deux interlignes et demi au-dessus. */
const CLE_DESSUS = 26;
/**
 * En dessous, on réserve d'office la place du bas de la tessiture de la
 * guitare : le mi grave sous ses trois lignes supplémentaires, et le dièse du
 * fa grave, qui descend plus bas encore. La clé et son « 8 » y tiennent, et
 * surtout la portée garde la même hauteur d'un exercice à l'autre au lieu de
 * sauter selon la tonalité.
 */
const CLE_DESSOUS = 45;

const MARGE = 4;

/**
 * Largeur du plus long motif possible : neuf notes d'aller-retour, la
 * première portant un double bémol. La vue dimensionne chaque portée en
 * proportion de celle-ci, pour que toutes soient dessinées **à la même
 * échelle** : une gamme de huit notes n'apparaît pas plus grosse qu'un
 * arpège de neuf.
 */
export const LARGEUR_REFERENCE =
  MARGE + CLE_X + CLE_LARGEUR + APRES_CLE + 13 + JEU_ALTERATION +
  2 * TETE_DEMI_LARGEUR + 8 * PAS + SEPARATION + FIN + MARGE;

/** Rangées de texte sous la portée : noms des notes, degrés, puis placement
 *  rythmique jugé au micro — rangée réservée d'office, pour que la portée ne
 *  saute pas quand les premiers verdicts arrivent. */
const ECART_NOMS = 16;
const ECART_DEGRES = 20;
const ECART_PLACEMENT = 18;
export const TAILLE_TEXTE = 13;

export interface NotePlacee {
  /** Nom tel qu'écrit dans la carte (« F# », « Bbb »). */
  nom: string;
  /** Altération en demi-tons, de −2 à +2. */
  alter: number;
  /** Centre de la tête. */
  x: number;
  y: number;
  /** Hampe vers le haut sous la troisième ligne, vers le bas à partir d'elle. */
  hampe: 'haut' | 'bas';
  /** Hauteurs des lignes supplémentaires à tracer sous la tête. */
  lignesSupplementaires: number[];
  /** Bord gauche de l'altération, ou `null` sans altération. */
  xAlteration: number | null;
}

export interface MiseEnPortee {
  largeur: number;
  hauteur: number;
  /** Hauteurs des cinq lignes, de la plus haute à la plus basse. */
  lignes: number[];
  /** Hauteur de la deuxième ligne (sol), sur laquelle s'enroule la clé. */
  ligneSol: number;
  /** Début et fin des lignes de la portée. */
  x0: number;
  x1: number;
  notes: NotePlacee[];
  /** Abscisse du trait qui sépare montée et descente, s'il y en a un. */
  separation: number | null;
  /** Bas de la zone où une note peut tomber (tête, hampe, altération). */
  yPied: number;
  /** Lignes de base des rangées de texte. */
  yNoms: number;
  yDegres: number;
  yPlacement: number;
}

const LETTRES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATUREL = [0, 2, 4, 5, 7, 9, 11];

/** Échelon diatonique du mi de la première ligne, une fois l'octave de la clé appliquée. */
const ECHELON_LIGNE_BASSE = 2 + 7 * 4; // mi 4 écrit

/**
 * Échelon diatonique **écrit** d'une note : lettre + 7 × octave, l'octave
 * étant tirée du MIDI (le nom de la carte n'en porte pas) puis relevée d'une
 * octave pour la clé de sol octaviée.
 *
 * L'octave se déduit de la lettre naturelle, pas du son : un do bémol sonne
 * comme un si, mais s'écrit à l'octave du do qui suit — même règle que
 * `transposeNote`.
 */
export function echelonEcrit(nom: string, midi: number): { echelon: number; alter: number } {
  const note = parseNote(nom);
  if (!note) throw new Error(`Note illisible : ${nom}`);
  const lettre = LETTRES.indexOf(note.letter);
  const octave = Math.floor((midi - (NATUREL[lettre] ?? 0) - note.alter) / 12) - 1;
  return { echelon: lettre + 7 * (octave + 1), alter: note.alter };
}

/**
 * Indice de la note du sommet d'un aller-retour — la dernière de la montée —,
 * ou `null` pour un motif qui ne fait que monter ou descendre.
 */
export function sommet(midis: number[], sens: string): number | null {
  if (sens !== 'aller-retour' || midis.length < 3) return null;
  const haut = midis.indexOf(Math.max(...midis));
  return haut > 0 && haut < midis.length - 1 ? haut : null;
}

/**
 * Place un motif sur la portée.
 *
 * `separationApres` : indice de la note qui clôt la montée d'un aller-retour
 * (la note du sommet), après laquelle un trait pointillé marque le demi-tour.
 */
export function mettreEnPortee(
  noms: string[],
  midis: number[],
  separationApres: number | null = null,
): MiseEnPortee {
  const demi = INTERLIGNE / 2;
  const echelons = noms.map((nom, i) => echelonEcrit(nom, midis[i] ?? 0));

  // --- Cadre vertical -------------------------------------------------------
  //
  // Calculé sur les notes, mais avec un minimum qui couvre toute la tessiture
  // du catalogue : la portée ne saute pas d'un exercice à l'autre.
  const relatif = (echelon: number): number => (echelon - ECHELON_LIGNE_BASSE) * demi;
  let dessus = CLE_DESSUS;
  let dessous = CLE_DESSOUS;
  for (const { echelon, alter } of echelons) {
    const h = relatif(echelon); // au-dessus de la ligne basse, en unités
    const versLeHaut = echelon < ECHELON_LIGNE_BASSE + 4;
    const sommet = h + demi + (versLeHaut ? HAMPE : 0);
    const pied = -h + demi + (versLeHaut ? 0 : HAMPE);
    const acc = HAUTEUR_ALTERATION[alter] ?? { haut: 0, bas: 0 };
    dessus = Math.max(dessus, sommet - 4 * INTERLIGNE, h + acc.haut - 4 * INTERLIGNE);
    dessous = Math.max(dessous, pied, -h + acc.bas);
  }

  const marge = MARGE;
  const ligneHaute = marge + dessus;
  const ligneBasse = ligneHaute + 4 * INTERLIGNE;
  const lignes = [0, 1, 2, 3, 4].map((i) => ligneHaute + i * INTERLIGNE);
  const yPied = ligneBasse + dessous;
  const yNoms = yPied + ECART_NOMS;
  const yDegres = yNoms + ECART_DEGRES;
  const yPlacement = yDegres + ECART_PLACEMENT;
  const hauteur = yPlacement + 5;

  // --- Placement horizontal -------------------------------------------------
  const premiere = echelons[0];
  let x =
    CLE_X + CLE_LARGEUR + APRES_CLE +
    (premiere ? (LARGEUR_ALTERATION[premiere.alter] ?? 0) + JEU_ALTERATION : 0) +
    TETE_DEMI_LARGEUR;
  let separation: number | null = null;

  const notes = echelons.map(({ echelon, alter }, i): NotePlacee => {
    if (i > 0) {
      x += PAS;
      if (separationApres !== null && i === separationApres + 1) {
        separation = x + SEPARATION / 2 - PAS / 2;
        x += SEPARATION;
      }
    }
    const y = ligneBasse - relatif(echelon);
    const lignesSupplementaires: number[] = [];
    // Sous la portée : do, la, fa… écrits (échelons pairs à partir de la ligne basse).
    for (let e = ECHELON_LIGNE_BASSE - 2; e >= echelon; e -= 2) {
      lignesSupplementaires.push(ligneBasse - relatif(e));
    }
    // Au-dessus : la, do, mi…
    for (let e = ECHELON_LIGNE_BASSE + 10; e <= echelon; e += 2) {
      lignesSupplementaires.push(ligneBasse - relatif(e));
    }
    const largeurAlteration = LARGEUR_ALTERATION[alter] ?? 0;
    return {
      nom: noms[i] ?? '',
      alter,
      x,
      y,
      hampe: echelon < ECHELON_LIGNE_BASSE + 4 ? 'haut' : 'bas',
      lignesSupplementaires,
      xAlteration:
        largeurAlteration > 0 ? x - TETE_DEMI_LARGEUR - JEU_ALTERATION - largeurAlteration : null,
    };
  });

  const x1 = x + TETE_DEMI_LARGEUR + FIN;
  return {
    largeur: x1 + marge,
    hauteur,
    lignes,
    ligneSol: ligneBasse - INTERLIGNE,
    x0: marge,
    x1,
    notes,
    separation,
    yPied,
    yNoms,
    yDegres,
    yPlacement,
  };
}
