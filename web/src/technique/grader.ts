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

/** Fenêtre de placement, en fraction de battue, de part et d'autre du clic. */
const WINDOW_RATIO = 0.3;

/** Au-delà, on considère qu'aucune attaque ne correspond à cette battue. */
const MATCH_RATIO = 0.5;

export interface NoteJouee {
  /** Hauteur attendue. */
  midi: number;
  /** Hauteur entendue, ou `null` si rien n'a été joué à cet endroit. */
  joue: number | null;
  /** Écart au clic en millisecondes, ou `null` faute d'attaque appariée. */
  ecartMs: number | null;
}

export interface Resultat {
  attendues: number;
  justes: number;
  dansLaFenetre: number;
  /** Écart absolu moyen au clic, sur les seules notes appariées. */
  ecartMoyenMs: number;
  detail: NoteJouee[];
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
      detail.push({ midi: attendu, joue: null, ecartMs: null });
      continue;
    }

    consumed.add(bestIndex);
    const onset = onsets[bestIndex];
    const ecart = (onset?.audioTime ?? 0) - cible;
    const joue = onset?.midi ?? 0;

    if (joue === attendu) justes += 1;
    if (Math.abs(ecart) <= beat * WINDOW_RATIO) dansLaFenetre += 1;
    ecartTotal += Math.abs(ecart);
    apparies += 1;

    detail.push({ midi: attendu, joue, ecartMs: ecart * 1000 });
  }

  return {
    attendues: detail.length,
    justes,
    dansLaFenetre,
    ecartMoyenMs: apparies === 0 ? 0 : (ecartTotal / apparies) * 1000,
    detail,
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
