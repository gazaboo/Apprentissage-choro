/** Page Technique : les arpèges et gammes du jour, puis le catalogue.
 *
 * Même grammaire que la page Répertoire : une carte « Aujourd'hui » nomme les
 * exercices prioritaires que la séance va proposer, et le catalogue suit.
 * Celui-ci produit plus d'une centaine de tonalités : les montrer toutes
 * d'un coup en faisait un mur de pastilles. Chaque motif tient donc sur une
 * ligne — une barre de douze segments, un par tonalité, colorés selon leur
 * état — et se déplie sur ses pastilles, qui lancent une séance ciblée.
 *
 * Une setlist de technique (distincte de celle du répertoire, #127) permet de
 * restreindre ce vivier à une sélection — ex. les tonalités sans dièse ni
 * bémol. Elle ne filtre que le vivier passé à `pickExercices` : aucun ordre de
 * passage n'est imposé, le FSRS garde la main sur la priorisation.
 */

import { el, ui } from '../dom';
import { chevronDown } from '../icons';
import { statusOf } from '../srs';
import type { Status } from '../srs';
import type { Progress } from '../store';
import { activeTechniqueSetlist, getTechniqueCard, setActiveTechniqueSetlist } from '../store';
import type { ExerciceCarte, Sens } from '../technique/catalogue';
import {
  dernierBpm,
  parAccord,
  parFamille,
  parMotif,
  pickExercices,
} from '../technique/catalogue';
import {
  historyBlock,
  priorityCard,
  scopePicker,
  sectionHeader,
  sectionLayout,
  sectionSubtitle,
  shortDate,
  type PriorityItem,
} from './section-ui';
import { openTechniqueSetlistEditor } from './technique-setlists';
import type { TechniqueSetlistTarget } from './technique-setlists';

const STATUS_STYLES: Record<Status, string> = {
  jamais: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  'a-reviser': 'border-amber-400/40 bg-amber-400/15 text-amber-200',
  'a-jour': 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

const SEGMENT_STYLES: Record<Status, string> = {
  jamais: 'bg-zinc-800',
  'a-reviser': 'bg-amber-400',
  'a-jour': 'bg-emerald-400',
};

const SENS_FLECHES: Record<Sens, string> = {
  montant: '↑',
  descendant: '↓',
  'aller-retour': '↕',
};

/** Lignes montrées dans la carte ; le reste est annoncé en « et N autres ». */
const LIGNES_CARTE = 5;

export interface TechniqueListeContext {
  progress: Progress;
  cartes: ExerciceCarte[];
  /** `ordre` : les exercices annoncés par la carte, repris tels quels. */
  onStart: (ordre: ExerciceCarte[]) => void;
  /** Lance une séance restreinte à une tonalité précise (les deux sens). */
  onStartTonalite: (cartes: ExerciceCarte[]) => void;
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

  /** État d'une tonalité, tous sens confondus : la plus urgente de ses cartes. */
  function statusAccord(cartesAccord: ExerciceCarte[]): Status {
    const statuses = cartesAccord.map((carte) => statusOf(getTechniqueCard(progress, carte.id)));
    if (statuses.includes('a-reviser')) return 'a-reviser';
    return statuses.includes('jamais') ? 'jamais' : 'a-jour';
  }

  const subtitle = sectionSubtitle();
  const cardSlot = el('div');
  const bodySlot = el('div', { class: 'flex flex-col gap-6' });
  const historyState = { expanded: false };
  /** Motifs dépliés, gardés d'un rendu à l'autre. */
  const ouverts = new Set<string>();
  let closeModal: (() => void) | null = null;

  function openEditor(target: TechniqueSetlistTarget): void {
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

  const picker = scopePicker({
    label: 'Setlist de technique travaillée',
    createLabel: 'Nouvelle setlist',
    options: () => [
      { id: '', name: 'Tout le catalogue' },
      ...progress.techniqueSetlists.map((set) => ({ id: set.id, name: set.name })),
    ],
    activeId: () => progress.activeTechniqueSetlistId ?? '',
    onChoose: (id) => {
      setActiveTechniqueSetlist(progress, id || null);
      repaint();
    },
    onEdit: (id) => {
      const set = progress.techniqueSetlists.find((entry) => entry.id === id);
      if (set) openEditor({ mode: 'edit', setlist: set });
    },
    onCreate: () => openEditor({ mode: 'create' }),
  });

  // --- En-tête ------------------------------------------------------------

  function paintHeader(scoped: ExerciceCarte[]): void {
    // On compte les tonalités (ce que montrent les pastilles), pas les cartes :
    // une gamme a un sens montant et un sens descendant par tonalité (#72).
    let tonalites = 0;
    let travaillees = 0;
    for (const list of parMotif(scoped).values()) {
      for (const cartesAccord of parAccord(list).values()) {
        tonalites += 1;
        if (statusAccord(cartesAccord) !== 'jamais') travaillees += 1;
      }
    }
    subtitle.textContent =
      `${tonalites} tonalité${tonalites > 1 ? 's' : ''} · ` +
      `${travaillees} travaillée${travaillees > 1 ? 's' : ''}`;
  }

  // --- Carte « Aujourd'hui » -----------------------------------------------

  function paintCard(scoped: ExerciceCarte[]): void {
    const ordre = pickExercices(scoped, progress);

    // Une ligne par tonalité d'un motif : ses sens se regroupent (↑↓).
    const lignes = new Map<string, ExerciceCarte[]>();
    for (const carte of ordre) {
      const key = `${carte.motifId}::${carte.accord}`;
      const list = lignes.get(key);
      if (list) list.push(carte);
      else lignes.set(key, [carte]);
    }
    const items: PriorityItem[] = [...lignes.values()].slice(0, LIGNES_CARTE).map((group) => {
      const first = group[0]!;
      const bpm = Math.max(
        0,
        ...group.map((carte) => dernierBpm(getTechniqueCard(progress, carte.id)) ?? 0),
      );
      return {
        label: `${first.nom} · ${first.accord} ${group.map((carte) => SENS_FLECHES[carte.sens]).join('')}`,
        fresh: group.every((carte) => statusOf(getTechniqueCard(progress, carte.id)) === 'jamais'),
        aside: bpm > 0 ? `${bpm} bpm` : null,
      };
    });

    const start = el(
      'button',
      { type: 'button', class: ui.primary, disabled: ordre.length === 0 },
      'Commencer la séance',
    );
    start.addEventListener('click', () => context.onStart(ordre));

    const runs = progress.sessions.filter((run) => run.kind === 'technique');
    const history = historyBlock(
      runs
        .slice(-10)
        .reverse()
        .map(
          (run) =>
            `${shortDate(run.date)} · ${run.songCount} exercice${run.songCount > 1 ? 's' : ''}`,
        ),
      historyState,
    );

    cardSlot.replaceChildren(
      priorityCard({
        title: ordre.length > 0 ? 'Exercices prioritaires' : 'Rien de prioritaire aujourd’hui',
        items,
        more: lignes.size - items.length,
        empty: 'Tout est à jour. Une tonalité du catalogue lance une séance ciblée.',
        actions: [start],
        footer: [
          el(
            'div',
            { class: 'flex flex-wrap items-start justify-between gap-x-4 gap-y-2' },
            el(
              'span',
              { class: 'text-xs text-zinc-500' },
              'Une note par clic de métronome, sans plaquer d’accord.',
            ),
            history ? el('div', { class: 'ml-auto flex flex-col' }, history) : null,
          ),
        ],
      }),
    );
  }

  // --- Catalogue -----------------------------------------------------------

  /** Un bouton par tonalité : il lance une séance sur cet accord, deux sens compris. */
  function chip(cartesAccord: ExerciceCarte[]): HTMLElement {
    const accord = cartesAccord[0]!.accord;
    const button = el(
      'button',
      {
        type: 'button',
        class:
          'inline-flex min-h-11 items-center justify-center rounded-lg border px-1 text-sm ' +
          'font-medium transition hover:border-zinc-500 focus:outline-none ' +
          `focus-visible:ring-2 focus-visible:ring-amber-400 ${STATUS_STYLES[statusAccord(cartesAccord)]}`,
      },
      accord,
    );
    button.addEventListener('click', () => context.onStartTonalite(cartesAccord));
    return button;
  }

  function motifRow(list: ExerciceCarte[]): HTMLElement[] {
    const motifId = list[0]!.motifId;
    const accords = [...parAccord(list).values()];
    const statuses = accords.map(statusAccord);
    const travaillees = statuses.filter((status) => status !== 'jamais').length;
    const ouvert = ouverts.has(motifId);
    const gridId = `motif-${motifId.replace(/[^a-z0-9-]/gi, '-')}`;

    const toggle = el(
      'button',
      {
        type: 'button',
        class:
          'flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition ' +
          'hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        'aria-expanded': String(ouvert),
        'aria-controls': gridId,
      },
      el(
        'span',
        { class: 'flex min-w-0 flex-1 flex-col gap-1.5' },
        el('span', { class: 'truncate text-base font-medium text-zinc-100' }, list[0]!.nom),
        el(
          'span',
          { class: 'flex gap-0.5', 'aria-hidden': 'true' },
          ...statuses.map((status) =>
            el('span', { class: `h-1.5 w-3 rounded-sm ${SEGMENT_STYLES[status]}` }),
          ),
        ),
      ),
      el(
        'span',
        { class: 'shrink-0 text-xs tabular-nums text-zinc-500' },
        `${travaillees}/${accords.length}`,
      ),
      el(
        'span',
        { class: `shrink-0 text-zinc-500 transition ${ouvert ? 'rotate-180' : ''}` },
        chevronDown(),
      ),
    );
    toggle.setAttribute(
      'aria-label',
      `${list[0]!.nom} : ${travaillees} tonalité${travaillees > 1 ? 's' : ''} ` +
        `travaillée${travaillees > 1 ? 's' : ''} sur ${accords.length}`,
    );
    toggle.addEventListener('click', () => {
      if (ouverts.has(motifId)) ouverts.delete(motifId);
      else ouverts.add(motifId);
      paintBody(pool());
    });

    return [
      toggle,
      ...(ouvert
        ? [
            el(
              'div',
              { id: gridId, class: 'grid grid-cols-4 gap-1.5 pb-3 pt-1 sm:grid-cols-6' },
              ...accords.map(chip),
            ),
          ]
        : []),
    ];
  }

  function paintBody(scoped: ExerciceCarte[]): void {
    bodySlot.replaceChildren(
      ...[...parFamille(scoped).entries()].map(([famille, group]) =>
        el(
          'section',
          { class: 'flex flex-col gap-1' },
          el('h2', { class: ui.label }, famille),
          el(
            'div',
            { class: 'flex flex-col divide-y divide-zinc-800/80' },
            ...[...parMotif(group).values()].map((list) =>
              el('div', {}, ...motifRow(list)),
            ),
          ),
        ),
      ),
    );
  }

  function repaint(): void {
    const scoped = pool();
    picker.refresh();
    paintHeader(scoped);
    paintCard(scoped);
    paintBody(scoped);
  }

  root.replaceChildren(
    sectionLayout(sectionHeader('Technique', subtitle, picker.element), cardSlot, bodySlot),
  );
  repaint();

  return () => {
    picker.close();
    closeModal?.();
  };
}
