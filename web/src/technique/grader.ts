/** Confronte ce qui a été joué à ce qui était attendu.
 *
 * Deux chiffres en sortent, volontairement séparés : la **justesse** (a-t-on
 * joué les bonnes notes ?) et le **placement** (sont-elles tombées avec le
 * clic ?). Les confondre en une note unique masquerait le cas le plus courant
 * du travail instrumental — les bonnes notes, mais pas encore en place.
 *
 * Ces chiffres informent l'auto-évaluation ; ils ne la remplacent pas. Le
 * détecteur se trompe parfois, en particulier quand les notes se recouvrent, et
 * il ne saurait décider seul de l'intervalle de révision.
 */

import type { Onset } from '../pitch';
import { nameFromMidi } from './theorie';

/** Fenêtre de placement, en fraction de battue, de part et d'autre du clic. */
const WINDOW_RATIO = 0.3;

/** Tolérance de placement, en millisecondes, pour une battue de `beatSeconds`. */
export function fenetrePlacementMs(beatSeconds: number): number {
  return beatSeconds * WINDOW_RATIO * 1000;
}

/** Au-delà, on considère qu'aucune attaque ne correspond à cette battue. */
const MATCH_RATIO = 0.5;

export interface NoteJouee {
  /** Hauteur attendue. */
  midi: number;
  /** Hauteur entendue, ou `null` si rien n'a été joué à cet endroit. */
  joue: number | null;
  /** Écart au clic en millisecondes, ou `null` faute d'attaque appariée. */
  ecartMs: number | null;
  /**
   * Cette note-ci est-elle tombée dans la fenêtre de placement ?
   *
   * Le compte global (`Resultat.dansLaFenetre`) dit combien de notes sont en
   * place ; celui-ci dit **lesquelles**, ce qui distingue une vraie fausse
   * note d'une note juste mais décalée — le cas courant d'une dérive de tempo.
   */
  dansLaFenetre: boolean;
}

export interface Resultat {
  attendues: number;
  justes: number;
  dansLaFenetre: number;
  /** Écart absolu moyen au clic, sur les seules notes appariées. */
  ecartMoyenMs: number;
  detail: NoteJouee[];
  /**
   * Rang, dans les `battues`/`attendues` reçues, de la battue qui a produit
   * `detail[0]` — les clics écoulés avant la première attaque sont écartés.
   * L'appelant en a besoin pour relier chaque ligne du détail à la battue
   * d'origine, donc à la passe et au temps qu'elle occupait dans le motif.
   */
  start: number;
}

/** Durée d'une battue, déduite des instants relevés — médiane des écarts. */
function beatDuration(battues: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < battues.length; i += 1) {
    gaps.push((battues[i] ?? 0) - (battues[i - 1] ?? 0));
  }
  if (gaps.length === 0) return 1;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 1;
}

/**
 * `attendues` et `battues` vont de pair : une hauteur par clic. `onsets` est ce
 * que le micro a entendu, dans l'ordre.
 *
 * Les battues qui précèdent la première attaque sont écartées : on ne compte
 * pas comme fautes les clics écoulés pendant qu'on se met en place. Le décompte
 * commence quand on commence à jouer.
 */
export function noter(attendues: number[], battues: number[], onsets: Onset[]): Resultat {
  const vide: Resultat = {
    attendues: 0,
    justes: 0,
    dansLaFenetre: 0,
    ecartMoyenMs: 0,
    detail: [],
    start: 0,
  };
  if (attendues.length === 0 || battues.length === 0 || onsets.length === 0) return vide;

  const beat = beatDuration(battues);
  const first = onsets[0]?.audioTime ?? 0;
  const start = battues.findIndex((time) => time >= first - beat * MATCH_RATIO);
  if (start === -1) return vide;

  const consumed = new Set<number>();
  const detail: NoteJouee[] = [];
  let justes = 0;
  let dansLaFenetre = 0;
  let ecartTotal = 0;
  let apparies = 0;

  for (let i = start; i < battues.length && i < attendues.length; i += 1) {
    const cible = battues[i] ?? 0;
    const attendu = attendues[i] ?? 0;

    // Attaque libre la plus proche du clic, dans la limite d'une demi-battue.
    let bestIndex = -1;
    let bestGap = Infinity;
    for (let j = 0; j < onsets.length; j += 1) {
      if (consumed.has(j)) continue;
      const gap = Math.abs((onsets[j]?.audioTime ?? 0) - cible);
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = j;
      }
    }

    if (bestIndex === -1 || bestGap > beat * MATCH_RATIO) {
      detail.push({ midi: attendu, joue: null, ecartMs: null, dansLaFenetre: false });
      continue;
    }

    consumed.add(bestIndex);
    const onset = onsets[bestIndex];
    const ecart = (onset?.audioTime ?? 0) - cible;
    const joue = onset?.midi ?? 0;

    const enPlace = Math.abs(ecart) <= beat * WINDOW_RATIO;
    if (joue === attendu) justes += 1;
    if (enPlace) dansLaFenetre += 1;
    ecartTotal += Math.abs(ecart);
    apparies += 1;

    detail.push({ midi: attendu, joue, ecartMs: ecart * 1000, dansLaFenetre: enPlace });
  }

  return {
    attendues: detail.length,
    justes,
    dansLaFenetre,
    ecartMoyenMs: apparies === 0 ? 0 : (ecartTotal / apparies) * 1000,
    detail,
    start,
  };
}

/**
 * Décalage du motif qui explique le mieux ce qui a été joué.
 *
 * Le clic accentué marque la première note, mais rien n'empêche d'entrer sur
 * une autre : l'arpège reste le même, seul le point de départ change. Sans
 * cette recherche, un motif joué parfaitement mais entamé un temps trop tard
 * serait noté zéro — un chiffre faux, et le musicien cesserait à juste titre
 * d'y prêter attention.
 *
 * On ne pardonne que la rotation, jamais l'ordre : jouer les bonnes notes dans
 * le désordre reste compté comme faux.
 */
export function meilleurDecalage(
  motif: number[],
  battues: { index: number; time: number }[],
  onsets: Onset[],
): number {
  if (motif.length === 0) return 0;

  let best = 0;
  let bestScore = -1;
  for (let decalage = 0; decalage < motif.length; decalage += 1) {
    const attendues = battues.map(
      (beat) => motif[(beat.index + decalage) % motif.length] ?? 0,
    );
    const { justes } = noter(attendues, battues.map((beat) => beat.time), onsets);
    if (justes > bestScore) {
      bestScore = justes;
      best = decalage;
    }
  }
  return best;
}

/** Phrase de contexte du questionnaire — jamais un verdict, un relevé. */
export function resume(resultat: Resultat, bpm: number): string {
  if (resultat.attendues === 0) {
    return `Travaillé à ${bpm} BPM. Le micro n’a rien entendu.`;
  }
  const ecart = Math.round(resultat.ecartMoyenMs);
  return (
    `Travaillé à ${bpm} BPM. ${resultat.justes} note${resultat.justes > 1 ? 's' : ''} juste${
      resultat.justes > 1 ? 's' : ''
    } sur ${resultat.attendues}, ` +
    `${resultat.dansLaFenetre} dans le tempo (écart moyen ${ecart} ms). ` +
    'Relevé indicatif — à vous de juger.'
  );
}

/**
 * Relevé note à note de ce qui reste à vérifier, une ligne de texte par note.
 *
 * Le résumé chiffré ne dit pas *où* ça a accroché, et sans ce détail on ne peut
 * pas distinguer une faute de jeu d'une erreur du détecteur — doute qui suffit
 * à faire cesser de se fier au relevé. Les notes déjà justes et en place sont
 * omises : elles sont comptées dans le résumé, les lister noierait le reste.
 *
 * `battues` est la suite complète des battues relevées (celle passée à
 * `noter()`), dont `Resultat.start` donne le point d'entrée : c'est l'index de
 * battue qui redonne la passe et le temps dans le motif.
 *
 * Comme `resume()`, ce relevé n'interprète rien — il rapporte.
 */
export function detailLignes(
  resultat: Resultat,
  battues: { index: number }[],
  motifLength: number,
): string[] {
  if (motifLength <= 0) return [];

  const lignes: string[] = [];
  resultat.detail.forEach((note, i) => {
    const juste = note.joue === note.midi;
    if (juste && note.dansLaFenetre) return;

    const beat = battues[resultat.start + i];
    if (!beat) return;
    const passe = Math.floor(beat.index / motifLength) + 1;
    const temps = (beat.index % motifLength) + 1;
    const ou = `Passe ${passe}, temps ${temps}`;
    const attendu = nameFromMidi(note.midi);

    if (note.joue === null) {
      lignes.push(`${ou} — attendu ${attendu}, rien entendu`);
      return;
    }

    const ecart = Math.round(note.ecartMs ?? 0);
    if (!juste) {
      const signe = ecart >= 0 ? '+' : '−';
      lignes.push(
        `${ou} — attendu ${attendu}, entendu ${nameFromMidi(note.joue)} ` +
          `(écart ${signe}${Math.abs(ecart)} ms)`,
      );
      return;
    }

    // Bonne note, hors fenêtre : le cas qui trahit une dérive de tempo plutôt
    // qu'une erreur de doigt, et qu'un simple « faux » masquerait.
    lignes.push(`${ou} — ${attendu} juste, mais décalé de ${Math.abs(ecart)} ms`);
  });

  return lignes;
}
