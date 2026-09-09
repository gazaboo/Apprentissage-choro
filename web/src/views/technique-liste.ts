/** Vue d'ensemble des arpèges et gammes, avant de lancer une séance.
 *
 * Le catalogue produit des dizaines de cartes : une liste ligne à ligne serait
 * illisible. On les présente donc en pastilles, groupées par famille puis par
 * motif — une grille où l'on voit d'un coup d'œil quelles tonalités sont à
 * jour et lesquelles ont décroché, sans avoir à lire.
 */

import { el, ui } from '../dom';
import { daysOverdue, statusOf } from '../srs';
import type { Status } from '../srs';
import type { Progress } from '../store';
import { getTechniqueCard } from '../store';
import type { ExerciceCarte } from '../technique/catalogue';
import { SENS_LABELS, parFamille, pickExercices } from '../technique/catalogue';

const SENS_MARKS: Record<string, string> = {
  montant: '↑',
  descendant: '↓',
  'aller-retour': '↕',
};

const STATUS_STYLES: Record<Status, string> = {
  jamais: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  'a-reviser': 'border-amber-400/40 bg-amber-400/15 text-amber-200',
  'a-jour': 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

export interface TechniqueListeContext {
  progress: Progress;
  cartes: ExerciceCarte[];
  onStart: () => void;
  navigateHome: () => void;
}

/** Échéance d'une carte, en toutes lettres — même formulation que le répertoire. */
function dueLabel(progress: Progress, carte: ExerciceCarte): string {
  const card = getTechniqueCard(progress, carte.id);
  if (statusOf(card) === 'jamais') return 'Jamais travaillé';
  const overdue = daysOverdue(card);
  if (overdue > 0) return `En retard de ${overdue} j`;
  if (overdue === 0) return "À réviser aujourd'hui";
  return `Revoir dans ${-overdue} j`;
}

export function renderTechniqueListe(
  root: HTMLElement,
  context: TechniqueListeContext,
): () => void {
  const { progress, cartes } = context;

  const aTravailler = pickExercices(cartes, progress);

  const startButton = el(
    'button',
    { type: 'button', class: ui.primary },
    aTravailler.length === 0
      ? 'Rien à réviser aujourd’hui'
      : `Commencer — ${aTravailler.length} exercice${aTravailler.length > 1 ? 's' : ''}`,
  );
  startButton.disabled = aTravailler.length === 0;
  startButton.addEventListener('click', context.onStart);

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour');
  backButton.addEventListener('click', context.navigateHome);

  /** Une pastille par carte : le chiffrage, une flèche de sens, l'état en couleur. */
  function chip(carte: ExerciceCarte): HTMLElement {
    const status = statusOf(getTechniqueCard(progress, carte.id));
    return el(
      'span',
      {
        class:
          'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border ' +
          `px-3 text-sm font-medium ${STATUS_STYLES[status]}`,
        title: `${carte.accord} · ${SENS_LABELS[carte.sens]} — ${dueLabel(progress, carte)}`,
      },
      carte.accord,
      el('span', { class: 'opacity-60' }, SENS_MARKS[carte.sens] ?? ''),
    );
  }

  /** Les motifs d'une famille, chacun avec sa rangée de tonalités. */
  function motifs(group: ExerciceCarte[]): HTMLElement[] {
    const byMotif = new Map<string, ExerciceCarte[]>();
    for (const carte of group) {
      const list = byMotif.get(carte.motifId);
      if (list) list.push(carte);
      else byMotif.set(carte.motifId, [carte]);
    }

    return [...byMotif.values()].map((list) => {
      const due = list.filter(
        (carte) => statusOf(getTechniqueCard(progress, carte.id)) !== 'a-jour',
      ).length;
      return el(
        'div',
        { class: 'flex flex-col gap-2' },
        el(
          'p',
          { class: 'text-sm text-zinc-300' },
          list[0]?.nom ?? '',
          el(
            'span',
            { class: 'ml-2 text-xs text-zinc-500' },
            due === 0 ? 'tout à jour' : `${due} sur ${list.length} à travailler`,
          ),
        ),
        el('div', { class: 'flex flex-wrap gap-2' }, ...list.map(chip)),
      );
    });
  }

  const sections = [...parFamille(cartes).entries()].map(([famille, group]) =>
    el(
      'section',
      { class: `${ui.card} flex flex-col gap-4` },
      el('h2', { class: 'text-lg font-medium text-zinc-100' }, famille),
      ...motifs(group),
    ),
  );

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8' },

      el(
        'header',
        { class: 'flex flex-wrap items-start justify-between gap-4' },
        el(
          'div',
          {},
          el('h1', { class: 'text-3xl font-semibold text-zinc-100' }, 'Arpèges et gammes'),
          el(
            'p',
            { class: 'mt-1 text-sm text-zinc-400' },
            `${cartes.length} exercices · ${aTravailler.length} à travailler`,
          ),
        ),
        backButton,
      ),

      el(
        'section',
        { class: 'rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5' },
        el(
          'div',
          { class: 'flex flex-col gap-3' },
          el('div', { class: 'flex flex-wrap gap-2' }, startButton),
          el(
            'span',
            { class: 'text-[11px] text-zinc-500' },
            'Les exercices en retard d’abord, puis quelques-uns jamais travaillés. ' +
              'Une note par clic de métronome, sans plaquer d’accord.',
          ),
        ),
      ),

      ...sections,
    ),
  );

  return () => {};
}
