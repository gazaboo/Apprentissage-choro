/** Page Répertoire : ce qu'on travaille aujourd'hui, puis tous les morceaux.
 *
 * La carte « Aujourd'hui » nomme les morceaux prioritaires que la séance va
 * proposer, avec l'exercice prévu pour chacun (avec ou sans partition). On
 * y parle de priorité, jamais de retard : un apprenant qui revient après
 * trois semaines retrouve la même petite dose, pas une dette à éponger.
 *
 * La liste, par ordre alphabétique, montre pour chaque morceau le parcours de
 * ses dernières séances — partition, partition masquée, par cœur — plutôt
 * qu'une échéance.
 */

import { el, ui } from '../dom';
import { parcours, PARCOURS_LONGUEUR, type ParcoursCase } from '../parcours';
import { pickSessionItems, type SessionItem } from '../session';
import { recommendedMode } from '../srs';
import type { Progress } from '../store';
import { activeSetlist, getCard, setActiveSetlist } from '../store';
import type { SessionRun, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS } from '../types';
import {
  historyBlock,
  modeBadge,
  priorityCard,
  scopePicker,
  sectionHeader,
  sectionLayout,
  sectionSubtitle,
  shortDate,
} from './section-ui';
import { openSetlistEditor } from './setlists';

export interface DashboardContext {
  progress: Progress;
  openSong: (songId: string) => void;
  /**
   * `items` : les morceaux prioritaires affichés dans la carte, pour que la
   * séance lancée soit exactement celle annoncée (le tirage départage les
   * égalités au hasard, il ne doit pas être refait au clic).
   */
  startSession: (kind: 'deep' | 'urgent', items?: SessionItem[]) => void;
  startFilage: () => void;
}

/** Nombre de morceaux d'une séance ciblée — le même que `startSession`. */
const PRIORITY_COUNT = 3;

const RUN_KIND_LABELS: Record<SessionRun['kind'], string> = {
  deep: 'travail de fond',
  urgent: 'morceaux prioritaires',
  filage: 'filage',
  technique: 'arpèges et gammes',
};

function runSummary(run: SessionRun): string {
  const kind =
    run.kind === 'filage' && run.instrumentId
      ? `filage ${INSTRUMENT_SHORT_LABELS[run.instrumentId]}`
      : RUN_KIND_LABELS[run.kind];
  return `${run.setlistName} · ${kind} · ${run.songCount} morceau${run.songCount > 1 ? 'x' : ''}`;
}

function songCards(song: Song, progress: Progress) {
  return song.instruments.map((instrument) => getCard(progress, song.id, instrument.id));
}

function reviewCount(song: Song, progress: Progress): number {
  return songCards(song, progress).reduce((total, card) => total + (card?.history.length ?? 0), 0);
}

const byTitle = (a: Song, b: Song): number => a.title.localeCompare(b.title, 'fr');

export function renderDashboard(
  root: HTMLElement,
  songs: Song[],
  context: DashboardContext,
): () => void {
  const { progress } = context;
  const songById = new Map(songs.map((song) => [song.id, song]));

  /** Vivier courant : la setlist active, ou tout le répertoire. */
  function scopedSongs(): Song[] {
    const set = activeSetlist(progress);
    return set ? songs.filter((song) => set.songIds.includes(song.id)) : songs;
  }

  /** Morceaux d'une setlist présents dans le manifeste courant. */
  function knownSongs(songIds: string[]): Song[] {
    return songIds
      .map((id) => songById.get(id))
      .filter((song): song is Song => song !== undefined);
  }

  const subtitle = sectionSubtitle();
  const cardSlot = el('div');
  const listSlot = el('section', { class: 'flex flex-col gap-1' });
  const historyState = { expanded: false };
  let closeModal: (() => void) | null = null;

  function openEditor(target: Parameters<typeof openSetlistEditor>[0]['target']): void {
    closeModal = openSetlistEditor({
      songs,
      progress,
      target,
      onClose: () => {
        closeModal = null;
        repaint();
      },
    });
  }

  const picker = scopePicker({
    label: 'Setlist travaillée',
    createLabel: 'Nouvelle setlist',
    options: () => [
      { id: '', name: 'Tout le répertoire', detail: `${songs.length} morceaux` },
      ...progress.setlists.map((set) => {
        const known = knownSongs(set.songIds);
        const count = `${known.length} morceau${known.length > 1 ? 'x' : ''}`;
        const titles = known.slice(0, 3).map((song) => song.title);
        return { id: set.id, name: set.name, detail: [count, ...titles].join(' · ') };
      }),
    ],
    activeId: () => progress.activeSetlistId ?? '',
    onChoose: (id) => {
      setActiveSetlist(progress, id || null);
      repaint();
    },
    onEdit: (id) => {
      const set = progress.setlists.find((entry) => entry.id === id);
      if (set) openEditor({ mode: 'edit', setlist: set });
    },
    onCreate: () => openEditor({ mode: 'create' }),
  });

  function paintHeader(scoped: Song[]): void {
    const worked = scoped.filter((song) => reviewCount(song, progress) > 0).length;
    subtitle.textContent =
      `${scoped.length} morceau${scoped.length > 1 ? 'x' : ''} · ` +
      `${worked} travaillé${worked > 1 ? 's' : ''}`;
  }

  function paintCard(scoped: Song[]): void {
    const set = activeSetlist(progress);
    const items = scoped.length > 0 ? pickSessionItems(scoped, progress, PRIORITY_COUNT) : [];

    const start = el(
      'button',
      { type: 'button', class: ui.primary, disabled: items.length === 0 },
      'Commencer la séance',
    );
    start.addEventListener('click', () => context.startSession('urgent', items));

    // Sans setlist, on peut parcourir tout le répertoire ; avec une setlist,
    // la seconde action est le filage — l'enchaîner comme en concert.
    const secondary = set
      ? el(
          'button',
          { type: 'button', class: ui.button, disabled: scoped.length === 0 },
          'Filer toute la setlist',
        )
      : el(
          'button',
          { type: 'button', class: ui.button, disabled: scoped.length === 0 },
          'Parcourir tout le répertoire',
        );
    secondary.addEventListener('click', () =>
      set ? context.startFilage() : context.startSession('deep'),
    );

    const links: HTMLElement[] = [];
    if (!set) {
      const filage = el(
        'button',
        {
          type: 'button',
          class:
            'text-xs text-zinc-400 underline decoration-dotted underline-offset-4 ' +
            'hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        },
        'Préparer un concert',
      );
      filage.addEventListener('click', () => context.startFilage());
      links.push(filage);
    }
    const runs = progress.sessions.filter((run) => run.kind !== 'technique');
    const history = historyBlock(
      runs
        .slice(-10)
        .reverse()
        .map((run) => `${shortDate(run.date)} · ${runSummary(run)}`),
      historyState,
    );

    cardSlot.replaceChildren(
      priorityCard({
        title: 'Morceaux prioritaires',
        items: items.map(({ song, instrumentId }) => {
          const card = getCard(progress, song.id, instrumentId);
          return {
            label: song.title,
            fresh: !card || card.history.length === 0,
            aside: modeBadge(recommendedMode(card) === 'sans'),
          };
        }),
        empty: 'Cette setlist ne contient aucun morceau du répertoire actuel.',
        actions: [start, secondary],
        footer:
          links.length > 0 || history
            ? [
                el(
                  'div',
                  { class: 'flex flex-wrap items-start justify-between gap-x-4 gap-y-2' },
                  ...links,
                  history ? el('div', { class: 'ml-auto flex flex-col' }, history) : null,
                ),
              ]
            : [],
      }),
    );
  }

  function paintList(scoped: Song[]): void {
    const set = activeSetlist(progress);
    const heading = el(
      'div',
      { class: 'flex items-baseline justify-between' },
      el('h2', { class: ui.label }, set ? 'Toute la setlist' : 'Tout le répertoire'),
      el('span', { class: 'text-xs text-zinc-500' }, String(scoped.length)),
    );
    if (scoped.length === 0) {
      listSlot.replaceChildren(
        heading,
        el(
          'p',
          { class: 'py-3 text-sm text-zinc-500' },
          'Cette setlist ne contient aucun morceau du répertoire actuel.',
        ),
      );
      return;
    }
    const rows = [...scoped].sort(byTitle).map((song) => songRow(song, progress, context));
    const anyTrail = scoped.some((song) => reviewCount(song, progress) > 0);
    listSlot.replaceChildren(
      heading,
      el('div', { class: 'flex flex-col divide-y divide-zinc-800/80' }, ...rows),
      ...(anyTrail ? [parcoursLegend()] : []),
    );
  }

  function repaint(): void {
    const scoped = scopedSongs();
    picker.refresh();
    paintHeader(scoped);
    paintCard(scoped);
    paintList(scoped);
  }

  root.replaceChildren(
    sectionLayout(sectionHeader('Répertoire', subtitle, picker.element), cardSlot, listSlot),
  );
  repaint();

  return () => {
    picker.close();
    closeModal?.();
  };
}

// --- Parcours ---------------------------------------------------------------

const CASE_STYLES: Record<ParcoursCase, string> = {
  partition: 'border-[1.5px] border-zinc-500',
  partiel: 'border-[1.5px] border-zinc-500 bg-zinc-500/50',
  'par-coeur': 'bg-emerald-400',
  'par-coeur-rate': 'border-[1.5px] border-rose-400',
  inconnu: 'bg-zinc-700/70',
};

const CASE_LABELS: Record<ParcoursCase, string> = {
  partition: 'avec partition',
  partiel: 'partition masquée',
  'par-coeur': 'par cœur',
  'par-coeur-rate': 'par cœur, raté',
  inconnu: 'séance ancienne',
};

function parcoursCell(kind: ParcoursCase): HTMLElement {
  return el('span', {
    class: `h-2.5 w-2.5 shrink-0 rounded-[3px] ${CASE_STYLES[kind]}`,
    'data-parcours': kind,
  });
}

/** Les `PARCOURS_LONGUEUR` dernières séances, les plus récentes à droite. */
function parcoursTrail(cases: ParcoursCase[]): HTMLElement {
  const parCoeur = cases.filter((kind) => kind === 'par-coeur').length;
  return el(
    'span',
    {
      class: 'flex shrink-0 items-center gap-[3px]',
      role: 'img',
      'aria-label':
        `${cases.length} dernière${cases.length > 1 ? 's' : ''} séance${cases.length > 1 ? 's' : ''}` +
        ` : ${parCoeur} par cœur réussie${parCoeur > 1 ? 's' : ''}`,
      title: cases.map((kind) => CASE_LABELS[kind]).join(' · '),
    },
    ...cases.map(parcoursCell),
  );
}

function parcoursLegend(): HTMLElement {
  const shown: ParcoursCase[] = ['partition', 'partiel', 'par-coeur', 'par-coeur-rate'];
  return el(
    'p',
    { class: 'flex flex-wrap gap-x-4 gap-y-1 pt-3 text-[11px] text-zinc-500' },
    el('span', {}, `${PARCOURS_LONGUEUR} dernières séances :`),
    ...shown.map((kind) =>
      el('span', { class: 'flex items-center gap-1.5' }, parcoursCell(kind), CASE_LABELS[kind]),
    ),
  );
}

function songRow(song: Song, progress: Progress, context: DashboardContext): HTMLElement {
  const count = reviewCount(song, progress);
  const cases = parcours(songCards(song, progress));
  const meta = [song.composer || 'Compositeur inconnu'];
  if (count > 0) meta.push(`${count} séance${count > 1 ? 's' : ''}`);

  const row = el(
    'button',
    {
      type: 'button',
      class:
        'flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-1 py-2.5 text-left ' +
        'transition hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
    },
    el(
      'span',
      { class: 'min-w-0' },
      el('span', { class: 'block truncate text-base font-medium text-zinc-100' }, song.title),
      el('span', { class: 'block truncate text-xs text-zinc-500' }, meta.join(' · ')),
    ),
    cases.length > 0 ? parcoursTrail(cases) : null,
  );
  row.addEventListener('click', () => context.openSong(song.id));
  return row;
}

export { pickSessionItems };
