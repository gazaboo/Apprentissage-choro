/** Tableau de bord : vue d'ensemble du répertoire, choix de setlist et séances.
 *
 * La liste porte une décision par morceau — travailler ou non — assortie d'un
 * rappel discret de l'échéance (« Revoir dans 11 j »). Le détail des
 * transpositions reste sur la page du morceau : il n'aide pas à choisir.
 */

import { el, ui } from '../dom';
import { pencil, plus, trash } from '../icons';
import { pickSessionItems } from '../session';
import { daysOverdue, statusOf } from '../srs';
import type { Progress } from '../store';
import { activeSetlist, deleteSetlist, getCard, setActiveSetlist } from '../store';
import { accountMode, getSyncCode } from '../sync';
import type { SessionRun, Song } from '../types';
import { INSTRUMENT_SHORT_LABELS } from '../types';
import { openSetlistEditor } from './setlists';

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
  openAccount: () => void;
  startSession: (kind: 'deep' | 'urgent') => void;
  startFilage: () => void;
  /** `null` quand le catalogue d'arpèges est absent : la section disparaît. */
  openTechnique: (() => void) | null;
  /** Nombre d'exercices que proposerait une séance lancée maintenant. */
  techniqueCount: number;
}

const RUN_KIND_LABELS: Record<SessionRun['kind'], string> = {
  deep: 'travail de fond',
  urgent: 'révision des urgences',
  filage: 'filage',
  technique: 'arpèges et gammes',
};

function runSummary(run: SessionRun): string {
  const kind =
    run.kind === 'filage' && run.instrumentId
      ? `filage ${INSTRUMENT_SHORT_LABELS[run.instrumentId]}`
      : RUN_KIND_LABELS[run.kind];
  const count =
    run.kind === 'technique'
      ? `${run.songCount} exercice${run.songCount > 1 ? 's' : ''}`
      : `${run.songCount} morceau${run.songCount > 1 ? 'x' : ''}`;
  return `${run.setlistName} · ${kind} · ${count}`;
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
  /** `true` quand la suppression de la setlist active attend confirmation. */
  let confirmingDelete = false;
  /** Retire l'écouteur de fermeture au clic extérieur, s'il est posé. */
  let closeDropdown: (() => void) | null = null;
  /** Ferme la modale d'édition si elle est ouverte (teardown). */
  let closeModal: (() => void) | null = null;

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

  /** Redessine tout ce qui dépend de la setlist active. */
  function repaintScope(): void {
    refreshDropdown();
    paintActions();
    paintPreview();
    paintHeader();
    paintList();
    paintSessionCard();
  }

  function chooseSetlist(id: string): void {
    setActiveSetlist(progress, id || null);
    previewExpanded = false;
    confirmingDelete = false;
    setDropdownOpen(false);
    repaintScope();
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

  // --- Actions setlist : nouvelle / modifier / supprimer ---------------

  function openEditor(target: Parameters<typeof openSetlistEditor>[0]['target']): void {
    setDropdownOpen(false);
    confirmingDelete = false;
    closeModal = openSetlistEditor({
      songs,
      progress,
      target,
      onClose: () => {
        closeModal = null;
        repaintScope();
      },
    });
  }

  const newButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Nouvelle setlist' },
    plus(),
  );
  newButton.addEventListener('click', () => openEditor({ mode: 'create' }));

  const editButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Modifier la setlist' },
    pencil(),
  );
  editButton.addEventListener('click', () => {
    const set = activeSetlist(progress);
    if (set) openEditor({ mode: 'edit', setlist: set });
  });

  const deleteButton = el(
    'button',
    { type: 'button', class: ui.icon, 'aria-label': 'Supprimer la setlist' },
    trash(),
  );
  deleteButton.addEventListener('click', () => {
    if (!activeSetlist(progress)) return;
    confirmingDelete = true;
    paintActions();
  });

  const actionSlot = el('div', { class: 'flex shrink-0 items-center gap-2' });

  function paintActions(): void {
    const set = activeSetlist(progress);
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
        deleteSetlist(progress, set.id);
        confirmingDelete = false;
        repaintScope();
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
      { class: 'flex flex-wrap items-start gap-2' },
      el('div', { class: 'relative min-w-[12rem] flex-1' }, dropTrigger, dropList),
      actionSlot,
    ),
    previewSlot,
  );

  // --- Session du jour -------------------------------------------------

  let sessionsExpanded = false;

  function paintSessionCard(): void {
    const set = activeSetlist(progress);
    const poolSize = scopedSongs().length;
    const empty = poolSize === 0;
    const urgentN = Math.min(3, poolSize);

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

    const filageButton = el(
      'button',
      { type: 'button', class: ui.button, disabled: empty },
      'Préparer un filage',
    );
    filageButton.addEventListener('click', () => context.startFilage());

    const rows: HTMLElement[] = [
      el('h2', { class: 'text-lg font-semibold text-zinc-100' }, 'Session du jour'),
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
          el('div', { class: 'flex flex-wrap gap-2' }, filageButton),
          el(
            'span',
            { class: 'text-[11px] text-zinc-500' },
            'La setlist enchaînée avec l’audio, décompte de 5 s entre les morceaux.',
          ),
        ),
      ),
    ];

    // Les arpèges et gammes ne dépendent d'aucune setlist : la rangée vient
    // après le répertoire, et disparaît si le catalogue est absent.
    if (context.openTechnique) {
      const techniqueButton = el(
        'button',
        { type: 'button', class: ui.button },
        context.techniqueCount > 0
          ? `Travailler — ${context.techniqueCount} exercice${context.techniqueCount > 1 ? 's' : ''}`
          : 'Voir les exercices',
      );
      techniqueButton.addEventListener('click', context.openTechnique);
      rows.push(
        el(
          'div',
          { class: 'flex flex-col gap-2 sm:flex-row sm:items-baseline' },
          el('span', { class: `${ui.label} sm:w-16 sm:shrink-0` }, 'Technique'),
          el(
            'div',
            { class: 'flex flex-col gap-1' },
            el('div', { class: 'flex flex-wrap gap-2' }, techniqueButton),
            el(
              'span',
              { class: 'text-[11px] text-zinc-500' },
              'Arpèges et gammes au métronome, note à note, hors répertoire.',
            ),
          ),
        ),
      );
    }

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

  // Identité en haut à droite : l'identifiant connecté, ou « Anonyme ».
  const identity = accountMode() === 'sync' ? getSyncCode() ?? 'Compte' : 'Anonyme';
  const accountLink = el(
    'button',
    {
      type: 'button',
      class: `${ui.button} max-w-[11rem]`,
      title: 'Compte et synchronisation',
    },
    el('span', { class: 'truncate' }, identity),
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
        accountLink,
      ),

      scopeRow,
      sessionSlot,

      el('section', { class: 'flex flex-col gap-4' }, list),
    ),
  );

  repaintScope();
  return () => {
    closeDropdown?.();
    closeModal?.();
  };
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
