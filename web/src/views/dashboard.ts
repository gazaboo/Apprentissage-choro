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

  const list = el('div', { class: 'grid gap-2' });
  const subtitle = el('p', { class: 'mt-1 text-sm text-zinc-400' });
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
  /** Retire l'écouteur de fermeture au clic extérieur, s'il est posé. */
  let closeDropdown: (() => void) | null = null;

  /** Morceaux d'une setlist présents dans le manifeste courant. */
  function knownSongs(set: ReturnType<typeof activeSetlist>): Song[] {
    if (!set) return songs;
    return set.songIds
      .map((id) => songById.get(id))
      .filter((song): song is Song => song !== undefined);
  }

  /** Ligne de détail d'une option : « 8 morceaux · Titre · Titre · Titre ». */
  function optionDetail(id: string): string {
    if (!id) return `${songs.length} morceaux`;
    const set = progress.setlists.find((entry) => entry.id === id) ?? null;
    const known = knownSongs(set);
    const count = `${known.length} morceau${known.length > 1 ? 'x' : ''}`;
    const titles = known.slice(0, 3).map((song) => song.title);
    return titles.length ? `${count} · ${titles.join(' · ')}` : count;
  }

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
    'aria-label': 'Setlist travaillée',
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
    setActiveSetlist(progress, id || null);
    previewExpanded = false;
    setDropdownOpen(false);
    refreshDropdown();
    paintPreview();
    paintHeader();
    paintList();
    paintSessionCard();
  }

  function refreshDropdown(): void {
    const activeId = progress.activeSetlistId ?? '';
    (dropTrigger.firstElementChild as HTMLElement).textContent =
      activeId ? progress.setlists.find((e) => e.id === activeId)?.name ?? 'Setlist' : 'Tout le répertoire';

    const entries: Array<{ id: string; name: string }> = [
      { id: '', name: 'Tout le répertoire' },
      ...progress.setlists.map((entry) => ({ id: entry.id, name: entry.name })),
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
          el('span', { class: 'text-xs text-zinc-500' }, optionDetail(id)),
        );
        option.addEventListener('click', () => chooseSetlist(id));
        return option;
      }),
    );
  }

  dropTrigger.addEventListener('click', () => {
    setDropdownOpen(dropList.classList.contains('hidden'));
  });

  const manageLink = el('button', { type: 'button', class: ui.button }, 'Gérer');
  manageLink.addEventListener('click', context.openSetlists);

  const previewSlot = el('div', { class: 'flex flex-col gap-1' });

  /** Aperçu des morceaux de la setlist active, sous le sélecteur. */
  function paintPreview(): void {
    const set = activeSetlist(progress);
    if (!set) {
      previewSlot.replaceChildren();
      return;
    }
    const known = knownSongs(set);
    const missing = set.songIds.length - known.length;

    if (known.length === 0) {
      previewSlot.replaceChildren(
        el(
          'p',
          { class: 'text-sm text-zinc-500' },
          'Cette setlist ne contient aucun morceau du répertoire actuel.',
        ),
      );
      return;
    }

    if (!previewExpanded) {
      const line = el(
        'p',
        { class: 'text-sm text-zinc-400' },
        known.slice(0, 5).map((song) => song.title).join(' · '),
      );
      const extra = known.length - 5;
      if (extra <= 0 && missing <= 0) {
        previewSlot.replaceChildren(line);
        return;
      }
      const more = el(
        'button',
        { type: 'button', class: 'text-sm text-amber-300/80 hover:text-amber-200' },
        extra > 0 ? `+ ${extra} autre${extra > 1 ? 's' : ''}` : 'voir la liste',
      );
      more.addEventListener('click', () => {
        previewExpanded = true;
        paintPreview();
      });
      previewSlot.replaceChildren(
        el('div', { class: 'flex flex-wrap items-baseline gap-x-2 gap-y-1' }, line, more),
      );
      return;
    }

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
      paintPreview();
    });
    previewSlot.replaceChildren(
      el('div', { class: 'flex flex-wrap gap-1.5' }, ...chips),
      ...(missing > 0
        ? [
            el(
              'p',
              { class: 'text-xs text-zinc-600' },
              `${missing} morceau${missing > 1 ? 'x' : ''} introuvable${missing > 1 ? 's' : ''}`,
            ),
          ]
        : []),
      collapse,
    );
  }

  const scopeRow = el(
    'section',
    { class: 'flex flex-col gap-2' },
    el('p', { class: ui.label }, 'Setlist travaillée'),
    el(
      'div',
      { class: 'flex items-start gap-2' },
      el('div', { class: 'relative min-w-0 flex-1' }, dropTrigger, dropList),
      manageLink,
    ),
    previewSlot,
  );

  function paintScope(): void {
    refreshDropdown();
    paintPreview();
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
    const visible = scopedSongs();
    list.replaceChildren(
      ...(visible.length === 0
        ? [
            el(
              'p',
              { class: 'text-sm text-zinc-500' },
              'Cette setlist ne contient aucun morceau du répertoire actuel.',
            ),
          ]
        : visible.map((song) => songRow(song, progress, context))),
    );
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

      scopeRow,
      sessionSlot,

      el('section', { class: 'flex flex-col gap-4' }, list),
    ),
  );

  paintScope();
  paintHeader();
  paintSessionCard();
  paintList();
  return () => closeDropdown?.();
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
