/** Vue d'ensemble des arpèges et gammes, avant de lancer une séance.
 *
 * Le catalogue produit des dizaines de cartes : une liste ligne à ligne serait
 * illisible. On les présente donc en pastilles, groupées par famille puis par
 * motif — une grille où l'on voit d'un coup d'œil quelles tonalités sont à
 * jour et lesquelles ont décroché, sans avoir à lire.
 *
 * Une setlist de technique (distincte de celle du répertoire, #127) permet de
 * restreindre ce vivier à une sélection prioritaire — ex. les tonalités sans
 * dièse ni bémol. Le sélecteur, calqué sur celui du tableau de bord, ne filtre
 * que le vivier passé à `pickExercices` : aucun ordre de passage n'est imposé,
 * le FSRS garde la main sur la priorisation.
 */

import { el, ui } from '../dom';
import { pencil, plus, trash } from '../icons';
import { daysOverdue, statusOf } from '../srs';
import type { Status } from '../srs';
import type { Progress } from '../store';
import {
  activeTechniqueSetlist,
  deleteTechniqueSetlist,
  getTechniqueCard,
  setActiveTechniqueSetlist,
} from '../store';
import type { ExerciceCarte } from '../technique/catalogue';
import { parAccord, parFamille, parMotif, pickExercices } from '../technique/catalogue';
import { openTechniqueSetlistEditor } from './technique-setlists';
import type { TechniqueSetlistTarget } from './technique-setlists';

const STATUS_STYLES: Record<Status, string> = {
  jamais: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  'a-reviser': 'border-amber-400/40 bg-amber-400/15 text-amber-200',
  'a-jour': 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

export interface TechniqueListeContext {
  progress: Progress;
  cartes: ExerciceCarte[];
  onStart: () => void;
  /** Lance une séance restreinte à une tonalité précise (les deux sens). */
  onStartTonalite: (cartes: ExerciceCarte[]) => void;
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

  /** Vivier courant : la setlist de technique active, ou tout le catalogue. */
  function pool(): ExerciceCarte[] {
    const set = activeTechniqueSetlist(progress);
    return set ? cartes.filter((carte) => set.exerciceIds.includes(carte.id)) : cartes;
  }

  let confirmingDelete = false;
  let closeDropdown: (() => void) | null = null;
  let closeModal: (() => void) | null = null;

  const startButton = el('button', { type: 'button', class: ui.primary });
  startButton.addEventListener('click', context.onStart);

  const headerCount = el('p', { class: 'mt-1 text-sm text-zinc-400' });
  const bodySlot = el('div', { class: 'flex flex-col gap-6' });

  // --- Sélecteur de setlist de technique ---------------------------------

  const dropTrigger = el(
    'button',
    {
      type: 'button',
      class:
        'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border ' +
        'border-zinc-700 bg-zinc-800 px-3 text-left text-sm text-zinc-200 ' +
        'hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    },
    el('span', { class: 'truncate' }),
    el('span', { class: 'shrink-0 text-zinc-500' }, '▾'),
  );

  const dropList = el('div', {
    class:
      'absolute left-0 right-0 z-20 mt-1 hidden max-h-80 overflow-y-auto rounded-lg ' +
      'border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50',
    role: 'listbox',
    'aria-label': 'Setlist de technique travaillée',
  });

  function setDropdownOpen(open: boolean): void {
    dropList.classList.toggle('hidden', !open);
    dropTrigger.setAttribute('aria-expanded', String(open));
    closeDropdown?.();
    closeDropdown = null;
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!dropList.contains(event.target as Node) && event.target !== dropTrigger) {
        setDropdownOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDropdownOpen(false);
    };
    // Différé : le clic qui vient d'ouvrir ne doit pas refermer aussitôt.
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    closeDropdown = () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }

  function chooseSetlist(id: string): void {
    setActiveTechniqueSetlist(progress, id || null);
    confirmingDelete = false;
    setDropdownOpen(false);
    repaint();
  }

  function refreshDropdown(): void {
    const activeId = progress.activeTechniqueSetlistId ?? '';
    (dropTrigger.firstElementChild as HTMLElement).textContent = activeId
      ? (progress.techniqueSetlists.find((entry) => entry.id === activeId)?.name ?? 'Setlist')
      : 'Tout le catalogue';

    const entries: Array<{ id: string; name: string }> = [
      { id: '', name: 'Tout le catalogue' },
      ...progress.techniqueSetlists.map((entry) => ({ id: entry.id, name: entry.name })),
    ];
    dropList.replaceChildren(
      ...entries.map(({ id, name }) => {
        const selected = id === activeId;
        const option = el(
          'button',
          {
            type: 'button',
            role: 'option',
            'aria-selected': String(selected),
            class:
              'flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-zinc-800 ' +
              'focus:bg-zinc-800 focus:outline-none ' +
              (selected ? 'bg-amber-400/10' : ''),
          },
          el(
            'span',
            { class: `text-sm ${selected ? 'font-medium text-amber-200' : 'text-zinc-200'}` },
            name,
          ),
        );
        option.addEventListener('click', () => chooseSetlist(id));
        return option;
      }),
    );
  }

  dropTrigger.addEventListener('click', () => {
    setDropdownOpen(dropList.classList.contains('hidden'));
  });

  // --- Actions : nouvelle / modifier / supprimer --------------------------

  function openEditor(target: TechniqueSetlistTarget): void {
    setDropdownOpen(false);
    confirmingDelete = false;
    closeModal = openTechniqueSetlistEditor({
      cartes,
      progress,
      target,
      onClose: () => {
        closeModal = null;
        repaint();
      },
    });
  }

  const newButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Nouvelle setlist de technique' },
    plus(),
  );
  newButton.addEventListener('click', () => openEditor({ mode: 'create' }));

  const editButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Modifier la setlist de technique' },
    pencil(),
  );
  editButton.addEventListener('click', () => {
    const set = activeTechniqueSetlist(progress);
    if (set) openEditor({ mode: 'edit', setlist: set });
  });

  const deleteButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Supprimer la setlist de technique' },
    trash(),
  );
  deleteButton.addEventListener('click', () => {
    if (!activeTechniqueSetlist(progress)) return;
    confirmingDelete = true;
    paintActions();
  });

  const actionSlot = el('div', { class: 'flex shrink-0 items-center gap-2' });

  function paintActions(): void {
    const set = activeTechniqueSetlist(progress);
    editButton.disabled = !set;
    deleteButton.disabled = !set;

    if (confirmingDelete && set) {
      const yes = el(
        'button',
        {
          type: 'button',
          class:
            'inline-flex min-h-11 items-center justify-center rounded-lg border ' +
            'border-rose-500/60 bg-rose-500/15 px-4 text-sm font-medium text-rose-200 ' +
            'transition hover:bg-rose-500/25 focus:outline-none focus-visible:ring-2 ' +
            'focus-visible:ring-rose-400',
        },
        'Supprimer',
      );
      yes.addEventListener('click', () => {
        deleteTechniqueSetlist(progress, set.id);
        confirmingDelete = false;
        repaint();
      });
      const no = el('button', { type: 'button', class: ui.button }, 'Annuler');
      no.addEventListener('click', () => {
        confirmingDelete = false;
        paintActions();
      });
      actionSlot.replaceChildren(
        el('span', { class: 'text-xs text-zinc-400' }, `Supprimer « ${set.name} » ?`),
        yes,
        no,
      );
    } else {
      actionSlot.replaceChildren(newButton, editButton, deleteButton);
    }
  }

  /**
   * Un bouton par tonalité, tous sens confondus : cliquer ouvre directement une
   * séance sur cet accord (comme « Travailler cette tonalité »), c'est donc là
   * que le sens se choisit — pas en doublant les pastilles avant même de jouer.
   */
  function chip(cartesAccord: ExerciceCarte[]): HTMLElement {
    const statuses = cartesAccord.map((carte) => statusOf(getTechniqueCard(progress, carte.id)));
    const status: Status = statuses.includes('a-reviser')
      ? 'a-reviser'
      : statuses.includes('jamais')
        ? 'jamais'
        : 'a-jour';
    const accord = cartesAccord[0]!.accord;
    const titre = cartesAccord.map((carte) => dueLabel(progress, carte)).join(' · ');

    const button = el(
      'button',
      {
        type: 'button',
        class:
          'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border ' +
          `px-3 text-sm font-medium transition hover:border-zinc-500 focus:outline-none ` +
          `focus-visible:ring-2 focus-visible:ring-amber-400 ${STATUS_STYLES[status]}`,
        title: `${accord} — ${titre}`,
      },
      accord,
    );
    button.addEventListener('click', () => context.onStartTonalite(cartesAccord));
    return button;
  }

  /** Les motifs d'une famille, chacun avec sa rangée de tonalités. */
  function motifs(group: ExerciceCarte[]): HTMLElement[] {
    return [...parMotif(group).values()].map((list) => {
      // Une tonalité, un bouton — les cartes montant/descendant s'y regroupent.
      // Le décompte affiché porte sur les tonalités (ce que montrent les
      // pastilles), pas sur les cartes : une gamme a un sens montant et un
      // sens descendant par tonalité, donc deux fois plus de cartes que de
      // tonalités visibles à l'écran.
      const accords = [...parAccord(list).values()];
      const due = accords.filter((cartesAccord) =>
        cartesAccord.some(
          (carte) => statusOf(getTechniqueCard(progress, carte.id)) !== 'a-jour',
        ),
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
            due === 0 ? 'tout à jour' : `${due} sur ${accords.length} à travailler`,
          ),
        ),
        el('div', { class: 'flex flex-wrap gap-2' }, ...accords.map(chip)),
      );
    });
  }

  function paintBody(): void {
    const scoped = pool();
    const aTravailler = pickExercices(scoped, progress);

    startButton.textContent =
      aTravailler.length === 0
        ? 'Rien à réviser aujourd’hui'
        : `Commencer — ${aTravailler.length} exercice${aTravailler.length > 1 ? 's' : ''}`;
    startButton.disabled = aTravailler.length === 0;

    headerCount.textContent = `${scoped.length} exercices · ${aTravailler.length} à travailler`;

    const sections = [...parFamille(scoped).entries()].map(([famille, group]) =>
      el(
        'section',
        { class: `${ui.card} flex flex-col gap-4` },
        el('h2', { class: 'text-lg font-medium text-zinc-100' }, famille),
        ...motifs(group),
      ),
    );
    bodySlot.replaceChildren(...sections);
  }

  /** Redessine tout ce qui dépend de la setlist de technique active. */
  function repaint(): void {
    refreshDropdown();
    paintActions();
    paintBody();
  }

  // --- Dernières séances de technique ------------------------------------
  // Venues de l'ancienne carte « Technique » du tableau de bord : depuis la
  // navigation par sections, cette page est le seul point d'entrée technique.

  const historySlot = el('div', { class: 'flex flex-col gap-2' });
  let historyExpanded = false;

  function paintHistory(): void {
    const runs = context.progress.sessions.filter((run) => run.kind === 'technique');
    if (runs.length === 0) {
      historySlot.replaceChildren();
      return;
    }
    const toggle = el(
      'button',
      { type: 'button', class: 'self-start text-sm text-amber-300/80 hover:text-amber-200' },
      historyExpanded ? 'Masquer les dernières séances' : 'Voir les dernières séances',
    );
    toggle.addEventListener('click', () => {
      historyExpanded = !historyExpanded;
      paintHistory();
    });
    const recent = runs.slice(-10).reverse();
    historySlot.replaceChildren(toggle);
    if (historyExpanded) {
      historySlot.append(
        el(
            'ul',
            { class: 'flex flex-col gap-1 text-sm text-zinc-400' },
            ...recent.map((run) =>
              el(
                'li',
                {},
                `${new Date(run.date).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                })} · ${run.songCount} exercice${run.songCount > 1 ? 's' : ''}`,
              ),
            ),
          ),
      );
    }
  }

  repaint();
  paintHistory();

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
          headerCount,
        ),
      ),

      el(
        'section',
        { class: 'flex flex-col gap-2' },
        el('p', { class: ui.label }, 'Setlist de technique'),
        el(
          'div',
          { class: 'flex flex-wrap items-start gap-2' },
          el('div', { class: 'relative min-w-[16rem] flex-1' }, dropTrigger, dropList),
          actionSlot,
        ),
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
          historySlot,
        ),
      ),

      bodySlot,
    ),
  );

  return () => {
    closeModal?.();
    closeDropdown?.();
  };
}
