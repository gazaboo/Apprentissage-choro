/** Répétition espacée : FSRS-6, modulé par l'aisance technique.
 *
 * FSRS (`ts-fsrs`) pilote la mémorisation via trois variables par carte —
 * stabilité, difficulté, récupérabilité — entraînées sur un large corpus de
 * révisions. L'aisance technique (sous-tempo / crispé / fluide) reste une
 * extension maison, appliquée *après* FSRS sur l'intervalle rendu : un
 * morceau récité de mémoire mais injouable au tempo n'est pas acquis, et
 * doit revenir plus tôt que ce que la seule mémorisation suggérerait. Ce
 * facteur ne modifie jamais la stabilité ni la difficulté FSRS elles-mêmes.
 *
 * `history` reste la source de vérité : `SrsCard.fsrs` n'en est qu'un cache
 * dérivé, reconstruit par rejeu via `ensureFsrs` s'il est absent ou perdu
 * (carte migrée depuis une ancienne version, ou champ effacé par un appareil
 * resté en retard à la synchro).
 */

import { createEmptyCard, fsrs, Rating, type Card as FsrsLibCard, type Grade } from 'ts-fsrs';
import type { FsrsState, SrsCard, Tempo } from './types';

const DEFAULT_EASE = 2.5;
const PASSING_GRADE = 3;
const HISTORY_LIMIT = 500;

/** Facteur appliqué à l'intervalle FSRS selon l'aisance déclarée. */
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

/**
 * `enable_short_term: false` garantit un intervalle rendu en jours entiers
 * (≥ 1) : on révise un morceau une fois par jour, jamais trois fois dans
 * l'heure — c'est ce qui rend FSRS compatible avec les dates `AAAA-MM-JJ`
 * locales manipulées partout ailleurs dans le projet.
 * `enable_fuzz: false` pour un résultat déterministe (tests, et le fuzz sert
 * à étaler la charge d'un paquet de milliers de cartes, pas de nos 52
 * morceaux). `maximum_interval: 365` : un choro qu'on n'a pas touché depuis
 * un an est perdu, quoi qu'en dise la courbe d'oubli.
 */
const scheduler = fsrs({
  enable_short_term: false,
  enable_fuzz: false,
  maximum_interval: 365,
  request_retention: 0.9,
});

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

/** Note 0–5 → note FSRS. Le seuil d'échec (`grade < 3`) reste celui de SM-2. */
function toRating(grade: number): Grade {
  if (grade < PASSING_GRADE) return Rating.Again;
  if (grade === PASSING_GRADE) return Rating.Hard;
  if (grade === 4) return Rating.Good;
  return Rating.Easy;
}

/** `due` n'est ici qu'un champ transitant : `scheduler.next` calcule le temps
 * écoulé depuis `last_review`, jamais depuis `due` (voir `abstract_scheduler`
 * dans `ts-fsrs`) — la valeur qu'on y met (tempo déjà appliqué) est donc sans
 * effet sur le calcul suivant. Vérifié par un test dédié, pour verrouiller
 * cette hypothèse contre une évolution amont. */
function toFsrsLibCard(state: FsrsState, dueIso: string): FsrsLibCard {
  return {
    due: new Date(`${dueIso}T00:00:00`),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReview ? new Date(`${state.lastReview}T00:00:00`) : undefined,
  };
}

function fromFsrsLibCard(card: FsrsLibCard): FsrsState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    state: card.state as FsrsState['state'],
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    lastReview: card.last_review ? isoDate(card.last_review) : null,
    scheduledDays: card.scheduled_days,
  };
}

export function newCard(): SrsCard {
  return {
    ease: DEFAULT_EASE,
    interval: 0,
    repetitions: 0,
    due: isoDate(today()),
    history: [],
    fsrs: fromFsrsLibCard(createEmptyCard(today())),
  };
}

/**
 * Valide la forme d'un état FSRS lu du stockage ou du réseau — pas seulement
 * sa présence. Utilisée par `ensureFsrs` et par `sync.ts` pour décider si un
 * `fsrs` reçu peut être fait confiance ou doit être reconstruit par rejeu.
 */
export function isFsrsState(value: unknown): value is FsrsState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<FsrsState>;
  return (
    typeof state.stability === 'number' &&
    typeof state.difficulty === 'number' &&
    (state.state === 0 || state.state === 1 || state.state === 2 || state.state === 3) &&
    typeof state.reps === 'number' &&
    typeof state.lapses === 'number' &&
    typeof state.learningSteps === 'number' &&
    (state.lastReview === null || typeof state.lastReview === 'string') &&
    typeof state.scheduledDays === 'number'
  );
}

/**
 * Garantit `card.fsrs` : le renvoie tel quel s'il est déjà là et valide,
 * sinon le reconstruit en rejouant `card.history` dans FSRS, date après date
 * et note après note — chaque étape réapplique le facteur de tempo de son
 * entrée. Une carte sans historique ressort en carte neuve. C'est ce qui
 * permet à une carte SM-2 héritée, à un état FSRS corrompu, ou à une carte
 * dont la synchro aurait perdu ce champ, de retrouver une stabilité et une
 * difficulté réelles plutôt qu'approximées depuis `ease`.
 */
export function ensureFsrs(card: SrsCard): SrsCard & { fsrs: FsrsState } {
  if (isFsrsState(card.fsrs)) return card as SrsCard & { fsrs: FsrsState };
  if (card.history.length === 0) {
    return { ...newCard(), due: card.due } as SrsCard & { fsrs: FsrsState };
  }

  let fsrsCard = createEmptyCard(new Date(`${card.history[0]!.date}T00:00:00`));
  let lastFactor = 1;
  for (const entry of card.history) {
    const reviewDate = new Date(`${entry.date}T00:00:00`);
    fsrsCard = scheduler.next(fsrsCard, reviewDate, toRating(entry.grade)).card;
    lastFactor = TEMPO_FACTOR[entry.tempo];
  }

  const fsrsState = fromFsrsLibCard(fsrsCard);
  const interval = Math.max(1, Math.round(fsrsState.scheduledDays * lastFactor));
  const lastReviewDate = new Date(`${card.history.at(-1)!.date}T00:00:00`);

  return {
    ease: card.ease,
    interval,
    repetitions: fsrsState.reps,
    due: isoDate(addDays(lastReviewDate, interval)),
    history: card.history,
    fsrs: fsrsState,
  };
}

/**
 * Applique une évaluation et retourne la carte mise à jour.
 * `hints` (indices éphémères déclenchés) n'entre pas dans le calcul : il n'est
 * conservé que comme trace, et sert à suggérer une note dans le questionnaire.
 *
 * `mesures` porte ce que les arpèges et gammes savent chiffrer — BPM tenu,
 * justesse et placement relevés au micro. Comme `hints`, c'est une trace :
 * l'intervalle reste décidé par la note et l'aisance déclarées, la machine ne
 * juge pas à la place du musicien.
 */
export function review(
  card: SrsCard | undefined,
  grade: number,
  tempo: Tempo,
  hints: number,
  mesures?: { bpm?: number; justesse?: number; placement?: number },
): SrsCard {
  const base = ensureFsrs(card ?? newCard());
  const clamped = Math.max(0, Math.min(5, Math.round(grade)));

  const fsrsCard = toFsrsLibCard(base.fsrs, base.due);
  const { card: nextFsrsCard } = scheduler.next(fsrsCard, today(), toRating(clamped));
  const nextFsrs = fromFsrsLibCard(nextFsrsCard);

  const interval = Math.max(1, Math.round(nextFsrs.scheduledDays * TEMPO_FACTOR[tempo]));

  return {
    ease: base.ease,
    interval,
    repetitions: nextFsrs.reps,
    due: isoDate(addDays(today(), interval)),
    history: [
      ...base.history,
      { date: isoDate(today()), grade: clamped, tempo, hints, ...(mesures ?? {}) },
    ].slice(-HISTORY_LIMIT),
    fsrs: nextFsrs,
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
  // `history` est la source de vérité pour « déjà travaillé », y compris
  // pour une carte migrée dont l'état FSRS n'a pas encore été reconstruit
  // (voir `ensureFsrs`).
  if (!card || card.history.length === 0) return 'jamais';
  return daysOverdue(card) >= 0 ? 'a-reviser' : 'a-jour';
}

export const STATUS_LABELS: Record<Status, string> = {
  jamais: 'Jamais travaillé',
  'a-reviser': 'À réviser',
  'a-jour': 'À jour',
};

export const MASTERY_LEVELS = 5;

/**
 * Niveau de maîtrise affiché (0 à `MASTERY_LEVELS`), dérivé de l'intervalle
 * SRS courant plutôt que de `repetitions` : ce dernier ne fait plus que
 * compter les révisions (`reps` de FSRS, y compris les échecs), et ne dit
 * donc rien de la maîtrise actuelle d'un morceau. `interval` ne descend
 * jamais sous 1, donc un échec ne fait jamais retomber la jauge à 0 — mais,
 * FSRS n'effaçant pas la stabilité acquise sur un échec, elle ne retombe pas
 * nécessairement à 1 non plus : un morceau très consolidé qui trébuche une
 * fois garde une partie de sa mémoire.
 */
export function masteryLevel(card: SrsCard | undefined): number {
  if (!card || card.history.length === 0) return 0;
  const { interval } = card;
  if (interval <= 1) return 1;
  if (interval <= 6) return 2;
  if (interval <= 15) return 3;
  if (interval <= 40) return 4;
  return 5;
}

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
