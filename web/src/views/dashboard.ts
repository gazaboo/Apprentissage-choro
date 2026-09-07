/** Tableau de bord : vue d'ensemble du répertoire, choix de setlist et séances.
 *
 * La liste porte une décision par morceau — travailler ou non — assortie d'un
 * rappel discret de l'échéance (« Revoir dans 11 j »). Le détail des
 * transpositions reste sur la page du morceau : il n'aide pas à choisir.
 */

import { el, ui } from '../dom';
import { pickSessionItems } from '../session';
import { daysOverdue, statusOf } from '../srs';
import type { Progress } from '../store';
import { activeSetlist, getCard, lastSession, setActiveSetlist } from '../store';
import { accountMode } from '../sync';
import type { InstrumentId, SessionRun, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS } from '../types';

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
  openSetlists: () => void;
  openAccount: () => void;
  startSession: (kind: 'deep' | 'urgent') => void;
  startFilage: (instrumentId: InstrumentId) => void;
}

const RUN_KIND_LABELS: Record<SessionRun['kind'], string> = {
  deep: 'travail de fond',
  urgent: 'révision des urgences',
  filage: 'filage',
};

/** « il y a 2 j », « hier », « aujourd'hui » à partir d'une date ISO. */
function relativeDay(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  if (days < 30) return `il y a ${Math.round(days / 7)} sem.`;
  return `il y a ${Math.round(days / 30)} mois`;
}

function runSummary(run: SessionRun): string {
  const kind =
    run.kind === 'filage' && run.instrumentId
      ? `filage ${INSTRUMENT_SHORT_LABELS[run.instrumentId]}`
      : RUN_KIND_LABELS[run.kind];
  return `${run.setlistName} · ${kind} · ${run.songCount} morceau${run.songCount > 1 ? 'x' : ''}`;
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

/** Échéance de révision du morceau, affichée discrètement dans la liste. */
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
  const subtitle = el('p', { class: 'mt-1 text-sm text-zinc-400' });
  const scopeSlot = el('section', { class: 'flex flex-col gap-2' });
  const sessionSlot = el('section', {
    class: 'rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-5',
  });

  const songById = new Map(songs.map((song) => [song.id, song]));

  /** Vivier courant : la setlist active, ou tout le répertoire. */
  function scopedSongs(): Song[] {
    const set = activeSetlist(progress);
    return set ? songs.filter((song) => set.songIds.includes(song.id)) : songs;
  }

  function paintHeader(): void {
    const scoped = scopedSongs();
    const due = scoped.filter(
      (song) => songBadge(song, progress) === 'a-travailler',
    ).length;
    const set = activeSetlist(progress);
    subtitle.textContent = set
      ? `Setlist « ${set.name} » · ${scoped.length} morceaux · ${due} à travailler`
      : `Tout le répertoire · ${scoped.length} morceaux · ${due} à travailler`;
  }

  // --- Sélecteur de setlist + aperçu ------------------------------------

  let previewExpanded = false;

  function paintScope(): void {
    const set = activeSetlist(progress);

    const selector = el(
      'select',
      {
        class:
          'min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 ' +
          'text-sm text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        'aria-label': 'Setlist active',
      },
      el('option', { value: '' }, 'Tout le répertoire'),
      ...progress.setlists.map((entry) => el('option', { value: entry.id }, entry.name)),
    ) as HTMLSelectElement;
    selector.value = progress.activeSetlistId ?? '';
    selector.addEventListener('change', () => {
      setActiveSetlist(progress, selector.value || null);
      previewExpanded = false;
      paintScope();
      paintHeader();
      paintList();
      paintSessionCard();
    });

    const manageLink = el('button', { type: 'button', class: ui.button }, 'Gérer');
    manageLink.addEventListener('click', context.openSetlists);

    const rows: Array<HTMLElement | null> = [
      el('div', { class: 'flex flex-wrap items-center gap-2' }, selector, manageLink),
    ];

    if (set) {
      const known = set.songIds
        .map((id) => songById.get(id))
        .filter((song): song is Song => song !== undefined);
      const missing = set.songIds.length - known.length;

      if (known.length === 0) {
        rows.push(
          el(
            'p',
            { class: 'text-sm text-zinc-500' },
            'Cette setlist ne contient aucun morceau du répertoire actuel.',
          ),
        );
      } else if (!previewExpanded) {
        const line = el(
          'p',
          { class: 'text-sm text-zinc-400' },
          known.slice(0, 5).map((song) => song.title).join(' · '),
        );
        const extra = known.length - 5;
        if (extra > 0 || missing > 0) {
          const more = el(
            'button',
            { type: 'button', class: 'text-sm text-amber-300/80 hover:text-amber-200' },
            extra > 0 ? `+ ${extra} autre${extra > 1 ? 's' : ''}` : 'voir la liste',
          );
          more.addEventListener('click', () => {
            previewExpanded = true;
            paintScope();
          });
          rows.push(
            el('div', { class: 'flex flex-wrap items-baseline gap-x-2 gap-y-1' }, line, more),
          );
        } else {
          rows.push(line);
        }
      } else {
        const chips = known.map((song) => {
          const chip = el(
            'button',
            {
              type: 'button',
              class:
                'rounded-full border border-zinc-700 bg-zinc-800/70 px-2.5 py-1 text-xs ' +
                'text-zinc-300 hover:border-zinc-500 hover:text-zinc-100',
            },
            song.title,
          );
          chip.addEventListener('click', () => context.openSong(song.id));
          return chip;
        });
        const collapse = el(
          'button',
          { type: 'button', class: 'self-start text-sm text-amber-300/80 hover:text-amber-200' },
          'réduire',
        );
        collapse.addEventListener('click', () => {
          previewExpanded = false;
          paintScope();
        });
        rows.push(
          el('div', { class: 'flex flex-wrap gap-1.5' }, ...chips),
          missing > 0
            ? el(
                'p',
                { class: 'text-xs text-zinc-600' },
                `${missing} morceau${missing > 1 ? 'x' : ''} introuvable${missing > 1 ? 's' : ''}`,
              )
            : null,
          collapse,
        );
      }
    }

    scopeSlot.replaceChildren(
      ...rows.filter((entry): entry is HTMLElement => entry !== null),
    );
  }

  // --- Session du jour -------------------------------------------------

  let sessionsExpanded = false;

  function paintSessionCard(): void {
    const set = activeSetlist(progress);
    const poolSize = scopedSongs().length;
    const empty = poolSize === 0;
    const urgentN = Math.min(3, poolSize);
    const last = lastSession(progress);

    const deepButton = el(
      'button',
      { type: 'button', class: ui.primary, disabled: empty },
      set ? 'Travailler toute la setlist' : 'Parcourir tout le répertoire',
    );
    deepButton.addEventListener('click', () => context.startSession('deep'));

    const urgentButton = el(
      'button',
      { type: 'button', class: ui.button, disabled: empty },
      urgentN <= 1 ? 'Réviser le plus en retard' : `Réviser les ${urgentN} plus en retard`,
    );
    urgentButton.addEventListener('click', () => context.startSession('urgent'));

    const filageButtons = (['c', 'bb', 'eb'] as InstrumentId[]).map((id) => {
      const button = el(
        'button',
        { type: 'button', class: ui.button, disabled: empty },
        INSTRUMENT_SHORT_LABELS[id],
      );
      button.addEventListener('click', () => context.startFilage(id));
      return button;
    });

    const rows: HTMLElement[] = [
      el('h2', { class: 'text-lg font-semibold text-zinc-100' }, 'Session du jour'),
      el(
        'p',
        { class: 'text-sm text-zinc-400' },
        last
          ? `Dernière séance ${relativeDay(last.date)} · ${runSummary(last)}`
          : 'Aucune séance pour l’instant.',
      ),
      el(
        'div',
        { class: 'flex flex-col gap-2 sm:flex-row sm:items-baseline' },
        el('span', { class: `${ui.label} sm:w-16 sm:shrink-0` }, 'Travail'),
        el('div', { class: 'flex flex-wrap gap-2' }, deepButton, urgentButton),
      ),
      el(
        'div',
        { class: 'flex flex-col gap-2 sm:flex-row sm:items-baseline' },
        el('span', { class: `${ui.label} sm:w-16 sm:shrink-0` }, 'Filage'),
        el(
          'div',
          { class: 'flex flex-col gap-1' },
          el('div', { class: 'flex flex-wrap gap-2' }, ...filageButtons),
          el(
            'span',
            { class: 'text-[11px] text-zinc-500' },
            'La setlist enchaînée avec l’audio, décompte de 5 s entre les morceaux.',
          ),
        ),
      ),
    ];

    if (progress.sessions.length > 0) {
      const toggle = el(
        'button',
        { type: 'button', class: 'self-start text-sm text-amber-300/80 hover:text-amber-200' },
        sessionsExpanded ? 'Masquer les dernières séances' : 'Voir les dernières séances',
      );
      toggle.addEventListener('click', () => {
        sessionsExpanded = !sessionsExpanded;
        paintSessionCard();
      });
      rows.push(toggle);

      if (sessionsExpanded) {
        const recent = [...progress.sessions].slice(-10).reverse();
        rows.push(
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
                })} · ${runSummary(run)}`,
              ),
            ),
          ),
        );
      }
    }

    sessionSlot.replaceChildren(el('div', { class: 'flex flex-col gap-3' }, ...rows));
  }

  function paintList(): void {
    const base = scopedSongs();
    const visible = base.filter((song) => {
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

    countLabel.textContent = `${visible.length} morceau${visible.length > 1 ? 'x' : ''} sur ${base.length}`;

    list.replaceChildren(
      ...(visible.length === 0
        ? [
            el(
              'p',
              { class: 'text-sm text-zinc-500' },
              base.length === 0
                ? 'Cette setlist ne contient aucun morceau du répertoire actuel.'
                : 'Aucun morceau ne correspond à ces filtres.',
            ),
          ]
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

  const setlistsLink = el('button', { type: 'button', class: ui.button }, 'Setlists');
  setlistsLink.addEventListener('click', context.openSetlists);

  const accountLink = el(
    'button',
    { type: 'button', class: ui.button },
    accountMode() === 'sync' ? 'Compte · synchro' : 'Compte',
  );
  accountLink.addEventListener('click', context.openAccount);

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8' },

      el(
        'header',
        { class: 'flex flex-wrap items-start justify-between gap-4' },
        el(
          'div',
          {},
          el('h1', { class: 'text-3xl font-semibold text-zinc-100' }, 'Répertoire de choros'),
          subtitle,
        ),
        el('div', { class: 'flex flex-wrap gap-2' }, setlistsLink, accountLink),
      ),

      scopeSlot,
      sessionSlot,

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

  paintScope();
  paintHeader();
  paintSessionCard();
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
      el('span', { class: 'block text-xs text-zinc-600' }, dueLabel(song, progress)),
    ),
    el(
      'span',
      {
        class: `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${BADGE_STYLES[badge]}`,
      },
      BADGE_LABELS[badge],
    ),
  );
  row.addEventListener('click', () => context.openSong(song.id));
  return row;
}

export { pickSessionItems };
