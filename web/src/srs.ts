/** Répétition espacée : variante de SM-2 modulée par l'aisance technique.
 *
 * La note de mémoire (0–5) pilote SM-2 classique. L'aisance technique
 * (sous-tempo / crispé / fluide) vient ensuite raccourcir l'intervalle :
 * un morceau récité de mémoire mais injouable au tempo n'est pas acquis, et
 * doit revenir plus tôt que ce que la seule mémorisation suggérerait.
 */

import type { SrsCard, Tempo } from './types';

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const PASSING_GRADE = 3;

/** Facteur appliqué à l'intervalle selon l'aisance déclarée. */
const TEMPO_FACTOR: Record<Tempo, number> = {
  'sous-tempo': 0.7,
  crispe: 0.85,
  fluide: 1.0,
};

export const TEMPO_LABELS: Record<Tempo, string> = {
  'sous-tempo': 'Sous-tempo',
  crispe: 'Tempo réel, crispé',
  fluide: 'Tempo réel, fluide',
};

export const GRADE_LABELS: string[] = [
  'Néant — rien ne revient',
  'Bribes — il a fallu la partition',
  'Difficile — nombreux indices',
  'Correct — quelques hésitations',
  'Bon — fluide, un indice ou deux',
  'Parfait — sans aucun indice',
];

export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Date ISO courte (AAAA-MM-JJ), en heure locale. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function newCard(): SrsCard {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    due: isoDate(today()),
    history: [],
  };
}

/**
 * Applique une évaluation et retourne la carte mise à jour.
 * `hints` (indices éphémères déclenchés) n'entre pas dans le calcul : il n'est
 * conservé que comme trace, et sert à suggérer une note dans le questionnaire.
 */
export function review(
  card: SrsCard | undefined,
  grade: number,
  tempo: Tempo,
  hints: number,
): SrsCard {
  const base = card ?? newCard();
  const clamped = Math.max(0, Math.min(5, Math.round(grade)));

  let { ease, interval, repetitions } = base;

  if (clamped < PASSING_GRADE) {
    // Échec : on repart du début, révision dès le lendemain.
    repetitions = 0;
    interval = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * ease);
  }

  // Ajustement classique de la facilité SM-2.
  ease = ease + (0.1 - (5 - clamped) * (0.08 + (5 - clamped) * 0.02));
  if (ease < MIN_EASE) ease = MIN_EASE;

  interval = Math.max(1, Math.round(interval * TEMPO_FACTOR[tempo]));

  return {
    ease,
    interval,
    repetitions,
    due: isoDate(addDays(today(), interval)),
    history: [
      ...base.history,
      { date: isoDate(today()), grade: clamped, tempo, hints },
    ].slice(-50),
  };
}

/** Nombre de jours de retard ; négatif si la révision n'est pas encore due. */
export function daysOverdue(card: SrsCard | undefined): number {
  if (!card) return Number.POSITIVE_INFINITY; // jamais travaillé = priorité max
  const due = new Date(`${card.due}T00:00:00`);
  return Math.round((today().getTime() - due.getTime()) / 86_400_000);
}

export type Status = 'jamais' | 'a-reviser' | 'a-jour';

export function statusOf(card: SrsCard | undefined): Status {
  if (!card || card.repetitions === 0) return 'jamais';
  return daysOverdue(card) >= 0 ? 'a-reviser' : 'a-jour';
}

export const STATUS_LABELS: Record<Status, string> = {
  jamais: 'Jamais travaillé',
  'a-reviser': 'À réviser',
  'a-jour': 'À jour',
};

/** Note suggérée dans le questionnaire, d'après les indices déclenchés. */
export function suggestGrade(hints: number, maskedCount: number): number {
  if (maskedCount === 0) return 4;
  const ratio = hints / maskedCount;
  if (ratio === 0) return 5;
  if (ratio <= 0.15) return 4;
  if (ratio <= 0.35) return 3;
  if (ratio <= 0.6) return 2;
  return 1;
}
