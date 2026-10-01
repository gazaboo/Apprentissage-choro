/** Fiche de conseils de travail : une page à lire, hors répétition espacée.
 *
 * Rien ici n'est noté ni planifié. Seul lien avec les cartes : un exercice
 * qui a son pendant dans le catalogue propose de le travailler au métronome,
 * et lance alors une séance ordinaire sur ces motifs.
 */

import { el, ui } from '../dom';
import * as icons from '../icons';
import type { ExerciceCarte } from '../technique/catalogue';
import type {
  ExerciceConseil,
  FicheConseils,
  SectionConseil,
  TableauConseil,
} from '../technique/conseils';

export interface TechniqueConseilsContext {
  fiche: FicheConseils;
  cartes: ExerciceCarte[];
  onBack: () => void;
  onTravailler: (cartes: ExerciceCarte[]) => void;
}

function tableau(data: TableauConseil): HTMLElement {
  return el(
    'div',
    { class: 'overflow-x-auto' },
    el(
      'table',
      { class: 'w-full border-collapse text-sm tabular-nums' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...data.entetes.map((entete) =>
            el(
              'th',
              { scope: 'col', class: 'px-1.5 py-1.5 text-left font-medium text-zinc-500' },
              entete,
            ),
          ),
        ),
      ),
      el(
        'tbody',
        {},
        ...data.lignes.map((ligne) =>
          el(
            'tr',
            { class: 'border-t border-zinc-800' },
            ...ligne.map((cellule, index) =>
              index === 0
                ? el(
                    'th',
                    { scope: 'row', class: 'whitespace-nowrap px-1.5 py-1.5 text-left font-medium text-zinc-300' },
                    cellule,
                  )
                : el('td', { class: 'px-1.5 py-1.5 text-zinc-100' }, cellule),
            ),
          ),
        ),
      ),
    ),
  );
}

function section(data: SectionConseil): HTMLElement {
  return el(
    'section',
    { class: `${ui.card} flex flex-col gap-3` },
    el('h2', { class: 'text-lg font-semibold text-zinc-100' }, data.titre),
    ...(data.paragraphes ?? []).map((texte) => el('p', { class: 'text-sm text-zinc-300' }, texte)),
    data.tableau ? tableau(data.tableau) : null,
    data.points
      ? el(
          'ul',
          { class: 'flex list-disc flex-col gap-2 pl-5 text-sm text-zinc-300 marker:text-zinc-600' },
          ...data.points.map((point) => el('li', {}, point)),
        )
      : null,
  );
}

export function renderTechniqueConseils(
  root: HTMLElement,
  context: TechniqueConseilsContext,
): () => void {
  const { fiche } = context;

  function exercice(data: ExerciceConseil, index: number): HTMLElement {
    const cartes = context.cartes.filter((carte) => data.motifs?.includes(carte.motifId));
    let travailler: HTMLElement | null = null;
    if (cartes.length > 0) {
      const noms = [...new Set(cartes.map((carte) => carte.nom))];
      travailler = el(
        'button',
        { type: 'button', class: `${ui.button} self-start`, 'data-travailler': '' },
        'Travailler au métronome',
      );
      travailler.addEventListener('click', () => context.onTravailler(cartes));
      travailler.title = noms.join(' · ');
    }
    return el(
      'li',
      { class: `${ui.card} flex flex-col gap-3` },
      el(
        'h3',
        { class: 'text-base font-semibold text-zinc-100' },
        el('span', { class: 'mr-2 tabular-nums text-amber-300' }, String(index + 1)),
        data.titre,
      ),
      el('p', { class: 'text-sm text-zinc-300' }, data.consigne),
      ...(data.phrases ?? []).map((phrase) =>
        el(
          'p',
          {
            class:
              'rounded-lg bg-zinc-950/60 px-3 py-2 font-mono text-sm leading-relaxed text-zinc-100',
          },
          phrase,
        ),
      ),
      data.suite ? el('p', { class: 'text-sm text-zinc-400' }, data.suite) : null,
      travailler,
    );
  }

  const back = el(
    'button',
    {
      type: 'button',
      class:
        'inline-flex min-h-11 items-center gap-1 self-start rounded-lg pr-3 text-sm text-zinc-400 ' +
        'transition hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
    },
    icons.chevronLeft(),
    'Technique',
  );
  back.addEventListener('click', context.onBack);

  root.replaceChildren(
    el(
      'article',
      { class: 'mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:py-8' },
      el(
        'header',
        { class: 'flex flex-col gap-2' },
        back,
        el('p', { class: ui.label }, `Conseils de travail · ${fiche.famille}`),
        el('h1', { class: 'text-2xl font-semibold text-zinc-100 text-balance' }, fiche.titre),
        el('p', { class: 'text-sm text-zinc-400' }, fiche.resume),
      ),
      ...fiche.sections.map(section),
      el(
        'section',
        { class: 'flex flex-col gap-3' },
        el('h2', { class: ui.label }, 'Exercices'),
        el('ol', { class: 'flex flex-col gap-3' }, ...fiche.exercices.map(exercice)),
      ),
      fiche.ecoute
        ? el(
            'section',
            { class: `${ui.card} flex flex-col gap-2` },
            el('h2', { class: 'text-base font-semibold text-zinc-100' }, 'À l’écoute'),
            el('p', { class: 'text-sm text-zinc-300' }, fiche.ecoute),
          )
        : null,
    ),
  );

  return () => {};
}
