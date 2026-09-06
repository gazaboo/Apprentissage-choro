/** Tableau de bord : vue d'ensemble du répertoire et lancement de la session.
 *
 * La liste ne porte qu'une information de décision par morceau — travailler,
 * ou non. Le détail (retard exact, transpositions disponibles) reste
 * accessible, mais en retrait : il n'aide pas à choisir, il encombre.
 */

import { el, ui } from '../dom';
import { pickSessionItems } from '../session';
import { daysOverdue, statusOf } from '../srs';
import type { Progress } from '../store';
import { getCard } from '../store';
import type { InstrumentId, Song } from '../types';

/** Les trois états SRS se ramènent à une seule décision pour l'utilisateur. */
type Badge = 'a-travailler' | 'a-jour';

const BADGE_LABELS: Record<Badge, string> = {
  'a-travailler': 'À travailler',
  'a-jour': 'À jour',
};

const BADGE_STYLES: Record<Badge, string> = {
  'a-travailler': 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30',
  'a-jour': 'bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25',
};

interface Filters {
  composer: string;
  instrument: string;
  badge: string;
}

export interface DashboardContext {
  progress: Progress;
  openSong: (songId: string) => void;
  startSession: (count: number) => void;
}

/**
 * Un morceau est « à jour » dès qu'une de ses transpositions l'est, et qu'aucune
 * n'est en retard.
 *
 * Exiger que toutes le soient reviendrait à ne jamais basculer le badge : les
 * morceaux ont trois transpositions et l'on n'en travaille qu'une, si bien que
 * les deux autres resteraient éternellement « jamais travaillées ».
 */
function songBadge(song: Song, progress: Progress): Badge {
  const statuses = song.instruments.map((instrument) =>
    statusOf(getCard(progress, song.id, instrument.id)),
  );
  if (statuses.includes('a-reviser')) return 'a-travailler';
  return statuses.includes('a-jour') ? 'a-jour' : 'a-travailler';
}

/** Détail du retard, réservé à l'infobulle du badge. */
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
  const filters: Filters = { composer: '', instrument: '', badge: '' };

  const composers = [...new Set(songs.map((song) => song.composer).filter(Boolean))].sort();
  const instruments = new Map<InstrumentId, string>();
  for (const song of songs) {
    for (const instrument of song.instruments) instruments.set(instrument.id, instrument.name);
  }

  const list = el('div', { class: 'grid gap-2' });
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
      if (filters.badge && songBadge(song, progress) !== filters.badge) return false;
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
          'min-h-11 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
          'text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
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

  const dueCount = songs.filter((song) => songBadge(song, progress) === 'a-travailler').length;

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8' },

      el(
        'header',
        {},
        el('h1', { class: 'text-3xl font-semibold text-zinc-100' }, 'Répertoire de choros'),
        el(
          'p',
          { class: 'mt-1 text-sm text-zinc-400' },
          `${songs.length} morceaux · ${dueCount} à travailler`,
        ),
      ),

      el(
        'section',
        { class: 'rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5' },
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
            'Toutes les transpositions',
            [...instruments].map(([id, name]) => [id, name]),
            (value) => {
              filters.instrument = value;
            },
          ),
          select(
            'Tous les statuts',
            (Object.keys(BADGE_LABELS) as Badge[]).map((key) => [key, BADGE_LABELS[key]]),
            (value) => {
              filters.badge = value;
            },
          ),
          countLabel,
        ),
        list,
      ),
    ),
  );

  paintList();
  return () => {};
}

function songRow(song: Song, progress: Progress, context: DashboardContext): HTMLElement {
  const badge = songBadge(song, progress);
  const row = el(
    'button',
    {
      type: 'button',
      class:
        'flex w-full min-h-16 items-center justify-between gap-4 rounded-xl border ' +
        'border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left transition ' +
        'hover:border-zinc-600 hover:bg-zinc-800/60 focus:outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-amber-400',
    },
    el(
      'span',
      { class: 'min-w-0' },
      el('span', { class: 'block text-lg font-medium text-zinc-100' }, song.title),
      el(
        'span',
        { class: 'block text-sm text-zinc-400' },
        song.composer || 'Compositeur inconnu',
      ),
      el(
        'span',
        { class: 'block text-xs text-zinc-600' },
        song.instruments.map((instrument) => instrument.name).join(' · '),
      ),
    ),
    el(
      'span',
      {
        class:
          `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${BADGE_STYLES[badge]}`,
        // Le retard exact ne sert qu'à qui le cherche : il ne pèse pas sur la
        // lecture de la liste.
        title: dueLabel(song, progress),
      },
      BADGE_LABELS[badge],
    ),
  );
  row.addEventListener('click', () => context.openSong(song.id));
  return row;
}

export { pickSessionItems };
