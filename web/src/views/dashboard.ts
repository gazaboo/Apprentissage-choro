/** Tableau de bord : vue d'ensemble du répertoire et lancement de la session. */

import { el, ui } from '../dom';
import { setShortcuts, SHORTCUT_HELP } from '../keyboard';
import { pickSessionItems } from '../session';
import { daysOverdue, statusOf, STATUS_LABELS } from '../srs';
import type { Status } from '../srs';
import type { Progress } from '../store';
import { getCard } from '../store';
import type { InstrumentId, Song } from '../types';

const STATUS_STYLES: Record<Status, string> = {
  jamais: 'bg-zinc-700 text-zinc-300',
  'a-reviser': 'bg-amber-400/20 text-amber-200',
  'a-jour': 'bg-emerald-400/15 text-emerald-300',
};

interface Filters {
  composer: string;
  instrument: string;
  status: string;
}

export interface DashboardContext {
  progress: Progress;
  openSong: (songId: string) => void;
  startSession: (count: number) => void;
}

/** Meilleur statut parmi les partitions d'un morceau. */
function songStatus(song: Song, progress: Progress): Status {
  const statuses = song.instruments.map((instrument) =>
    statusOf(getCard(progress, song.id, instrument.id)),
  );
  if (statuses.includes('a-reviser')) return 'a-reviser';
  if (statuses.includes('a-jour')) return 'a-jour';
  return 'jamais';
}

function dueLabel(song: Song, progress: Progress): string {
  const cards = song.instruments
    .map((instrument) => getCard(progress, song.id, instrument.id))
    .filter((card) => card !== undefined);
  if (cards.length === 0) return 'Jamais travaillé';

  const overdue = Math.max(...cards.map((card) => daysOverdue(card)));
  if (overdue > 0) return `En retard de ${overdue} j`;
  if (overdue === 0) return "À réviser aujourd'hui";
  return `Revoir dans ${-overdue} j`;
}

export function renderDashboard(
  root: HTMLElement,
  songs: Song[],
  context: DashboardContext,
): () => void {
  const { progress } = context;
  const filters: Filters = { composer: '', instrument: '', status: '' };

  const composers = [...new Set(songs.map((song) => song.composer).filter(Boolean))].sort();
  const instruments = new Map<InstrumentId, string>();
  for (const song of songs) {
    for (const instrument of song.instruments) instruments.set(instrument.id, instrument.name);
  }

  const list = el('div', { class: 'grid gap-3' });
  const countLabel = el('p', { class: 'text-sm text-zinc-500' });

  function paintList(): void {
    const visible = songs.filter((song) => {
      if (filters.composer && song.composer !== filters.composer) return false;
      if (
        filters.instrument &&
        !song.instruments.some((instrument) => instrument.id === filters.instrument)
      ) {
        return false;
      }
      if (filters.status && songStatus(song, progress) !== filters.status) return false;
      return true;
    });

    countLabel.textContent = `${visible.length} morceau${visible.length > 1 ? 'x' : ''} sur ${songs.length}`;

    list.replaceChildren(
      ...(visible.length === 0
        ? [el('p', { class: 'text-sm text-zinc-500' }, 'Aucun morceau ne correspond à ces filtres.')]
        : visible.map((song) => songRow(song, progress, context))),
    );
  }

  function select(
    label: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
  ): HTMLElement {
    const node = el(
      'select',
      {
        class:
          'rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        'aria-label': label,
      },
      el('option', { value: '' }, label),
      ...options.map(([value, text]) => el('option', { value }, text)),
    );
    node.addEventListener('change', () => {
      onChange((node as HTMLSelectElement).value);
      paintList();
    });
    return node;
  }

  const sessionButtons = [2, 3].map((count) => {
    const button = el(
      'button',
      { type: 'button', class: count === 2 ? ui.primary : ui.button },
      `${count} morceaux`,
    );
    button.addEventListener('click', () => context.startSession(count));
    return button;
  });

  const dueCount = songs.filter((song) => songStatus(song, progress) !== 'a-jour').length;

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6' },

      el(
        'header',
        { class: 'flex flex-wrap items-end justify-between gap-4' },
        el(
          'div',
          {},
          el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Répertoire de choros'),
          el(
            'p',
            { class: 'text-sm text-zinc-500' },
            `${songs.length} morceaux · ${dueCount} à travailler`,
          ),
        ),
      ),

      el(
        'section',
        {
          class:
            'rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-5',
        },
        el('h2', { class: 'text-lg font-semibold text-zinc-100' }, 'Session du jour'),
        el(
          'p',
          { class: 'mt-1 max-w-2xl text-sm text-zinc-400' },
          'Les morceaux les plus en retard sont travaillés en rotation alternée : ' +
            'on quitte chaque pièce avant qu’elle ne soit confortable, pour forcer ' +
            'un vrai rappel au retour.',
        ),
        el('div', { class: 'mt-4 flex flex-wrap items-center gap-2' }, ...sessionButtons),
      ),

      el(
        'section',
        { class: 'flex flex-col gap-4' },
        el(
          'div',
          { class: 'flex flex-wrap items-center gap-2' },
          select('Tous les compositeurs', composers.map((c) => [c, c]), (value) => {
            filters.composer = value;
          }),
          select(
            'Tous les instruments',
            [...instruments].map(([id, name]) => [id, name]),
            (value) => {
              filters.instrument = value;
            },
          ),
          select(
            'Tous les statuts',
            (Object.keys(STATUS_LABELS) as Status[]).map((key) => [key, STATUS_LABELS[key]]),
            (value) => {
              filters.status = value;
            },
          ),
          countLabel,
        ),
        list,
      ),

      shortcutHelp(),
    ),
  );

  paintList();
  setShortcuts({});
  return () => setShortcuts({});
}

function songRow(song: Song, progress: Progress, context: DashboardContext): HTMLElement {
  const status = songStatus(song, progress);
  const row = el(
    'button',
    {
      type: 'button',
      class:
        'flex w-full flex-wrap items-center justify-between gap-4 rounded-xl border ' +
        'border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left transition ' +
        'hover:border-zinc-600 hover:bg-zinc-800/60 focus:outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-amber-400',
    },
    el(
      'span',
      { class: 'min-w-0' },
      el('span', { class: 'block font-medium text-zinc-100' }, song.title),
      el(
        'span',
        { class: 'block text-sm text-zinc-500' },
        song.composer || 'Compositeur inconnu',
      ),
    ),
    el(
      'span',
      { class: 'flex items-center gap-3' },
      el(
        'span',
        { class: 'text-xs text-zinc-500' },
        dueLabel(song, progress),
      ),
      el(
        'span',
        { class: 'flex gap-1' },
        ...song.instruments.map((instrument) =>
          el(
            'span',
            {
              class:
                'rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400',
              title: instrument.name,
            },
            instrument.id.toUpperCase(),
          ),
        ),
      ),
      el(
        'span',
        { class: `rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}` },
        STATUS_LABELS[status],
      ),
    ),
  );
  row.addEventListener('click', () => context.openSong(song.id));
  return row;
}

function shortcutHelp(): HTMLElement {
  return el(
    'details',
    { class: 'rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3' },
    el(
      'summary',
      { class: 'cursor-pointer text-sm font-medium text-zinc-300' },
      'Raccourcis clavier',
    ),
    el(
      'dl',
      { class: 'mt-3 grid gap-2 sm:grid-cols-2' },
      ...SHORTCUT_HELP.flatMap(([key, description]) => [
        el(
          'div',
          { class: 'flex items-center gap-3' },
          el('dt', { class: ui.kbd }, key),
          el('dd', { class: 'text-sm text-zinc-400' }, description),
        ),
      ]),
    ),
  );
}

export { pickSessionItems };
