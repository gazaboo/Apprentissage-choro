/** Briques communes aux pages Répertoire et Technique.
 *
 * Les deux pages suivent la même grammaire : un en-tête court (titre,
 * décompte, pastille de setlist), une carte « Aujourd'hui » qui nomme ce que
 * la séance va proposer, puis le contenu complet. Sur desktop, la carte passe
 * en colonne de gauche et reste visible pendant qu'on fait défiler le reste.
 */

import { el } from '../dom';
import { pencil } from '../icons';

// --- En-tête --------------------------------------------------------------

export function sectionHeader(
  title: string,
  subtitle: HTMLElement,
  picker: HTMLElement,
): HTMLElement {
  return el(
    'header',
    { class: 'flex items-center justify-between gap-3' },
    el(
      'div',
      { class: 'min-w-0' },
      el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, title),
      subtitle,
    ),
    picker,
  );
}

export function sectionSubtitle(): HTMLElement {
  return el('p', { class: 'text-sm text-zinc-500' });
}

// --- Pastille de setlist ----------------------------------------------------

export interface ScopeOption {
  /** Chaîne vide : tout le vivier (répertoire entier, catalogue entier). */
  id: string;
  name: string;
  detail?: string;
}

export interface ScopePickerOptions {
  /** Nom accessible du menu, ex. « Setlist travaillée ». */
  label: string;
  createLabel: string;
  options: () => ScopeOption[];
  activeId: () => string;
  onChoose: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

export interface ScopePicker {
  element: HTMLElement;
  refresh: () => void;
  /** Referme le menu et retire ses écouteurs (teardown de la vue). */
  close: () => void;
}

/**
 * Pastille qui porte la setlist active et ouvre le menu des setlists. Chaque
 * setlist y a son bouton « Modifier » : on peut en retoucher une sans
 * l'activer, et la gestion (rare) ne prend plus de place sur la page.
 */
export function scopePicker(options: ScopePickerOptions): ScopePicker {
  const triggerLabel = el('span', { class: 'truncate' });
  const trigger = el(
    'button',
    {
      type: 'button',
      class:
        'inline-flex min-h-11 max-w-[11rem] items-center gap-1.5 rounded-full border ' +
        'border-amber-400/50 bg-amber-400/10 px-4 text-sm text-amber-200 transition ' +
        'hover:bg-amber-400/15 focus:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-400 sm:max-w-xs',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      'aria-label': options.label,
    },
    triggerLabel,
    el('span', { class: 'shrink-0 text-amber-300/70', 'aria-hidden': 'true' }, '▾'),
  );

  const menu = el('div', {
    class:
      'absolute right-0 top-full z-20 mt-1 hidden max-h-[70vh] w-[min(20rem,calc(100vw-2rem))] ' +
      'overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/50',
    role: 'menu',
    'aria-label': options.label,
  });

  let detach: (() => void) | null = null;

  function setOpen(open: boolean): void {
    menu.classList.toggle('hidden', !open);
    trigger.setAttribute('aria-expanded', String(open));
    detach?.();
    detach = null;
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Différé : le clic qui vient d'ouvrir ne doit pas refermer aussitôt.
    const timer = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    detach = () => {
      clearTimeout(timer);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }

  function refresh(): void {
    const activeId = options.activeId();
    const entries = options.options();
    triggerLabel.textContent =
      entries.find((entry) => entry.id === activeId)?.name ?? entries[0]?.name ?? '';

    const rows = entries.map(({ id, name, detail }) => {
      const selected = id === activeId;
      const choose = el(
        'button',
        {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(selected),
          class:
            'flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2 text-left ' +
            'focus:outline-none focus-visible:bg-zinc-800',
        },
        el(
          'span',
          { class: `truncate text-sm ${selected ? 'font-medium text-amber-200' : 'text-zinc-200'}` },
          name,
        ),
        detail ? el('span', { class: 'truncate text-xs text-zinc-500' }, detail) : null,
      );
      choose.addEventListener('click', () => {
        setOpen(false);
        options.onChoose(id);
      });

      let edit: HTMLElement | null = null;
      if (id) {
        edit = el(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class:
              'mr-2 inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border ' +
              'border-zinc-700 px-2.5 text-xs text-zinc-300 transition hover:border-zinc-500 ' +
              'hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
            'aria-label': `Modifier « ${name} »`,
          },
          pencil(),
          'Modifier',
        );
        edit.addEventListener('click', () => {
          setOpen(false);
          options.onEdit(id);
        });
      }

      return el(
        'div',
        {
          class: `flex items-center hover:bg-zinc-800/70 ${selected ? 'bg-amber-400/10' : ''}`,
        },
        choose,
        edit,
      );
    });

    const create = el(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class:
          'flex min-h-11 w-full items-center px-3 text-left text-sm text-amber-300 ' +
          'hover:bg-zinc-800/70 focus:outline-none focus-visible:bg-zinc-800',
      },
      `＋ ${options.createLabel}`,
    );
    create.addEventListener('click', () => {
      setOpen(false);
      options.onCreate();
    });

    menu.replaceChildren(
      ...rows,
      el('div', { class: 'my-1 border-t border-zinc-800', role: 'separator' }),
      create,
    );
  }

  trigger.addEventListener('click', () => setOpen(menu.classList.contains('hidden')));
  refresh();

  return {
    element: el('div', { class: 'relative shrink-0' }, trigger, menu),
    refresh,
    close: () => setOpen(false),
  };
}

// --- Carte « Aujourd'hui » ------------------------------------------------

export interface PriorityItem {
  label: string;
  /** Détail aligné à droite : mode d'exercice, dernier tempo… */
  aside?: HTMLElement | string | null;
  /** Jamais travaillé : pastille creuse plutôt que pleine. */
  fresh?: boolean;
}

export interface PriorityCardOptions {
  title: string;
  items: PriorityItem[];
  /** Éléments prioritaires non listés, annoncés en fin de liste. */
  more?: number;
  /** Texte affiché à la place de la liste quand elle est vide. */
  empty?: string;
  actions: HTMLElement[];
  footer?: HTMLElement[];
}

/**
 * Seul bloc encadré d'ambre de la page : ce que la séance va proposer
 * maintenant, nommément — pas un décompte de ce qui reste en souffrance.
 */
export function priorityCard(options: PriorityCardOptions): HTMLElement {
  const list =
    options.items.length > 0
      ? el(
          'ol',
          { class: 'flex flex-col gap-2' },
          ...options.items.map((item) =>
            el(
              'li',
              { class: 'flex min-h-6 items-center gap-2.5 text-sm text-zinc-100' },
              el('span', {
                class:
                  'h-2 w-2 shrink-0 rounded-full ' +
                  (item.fresh ? 'border-[1.5px] border-zinc-500' : 'bg-amber-400'),
                'aria-hidden': 'true',
              }),
              el('span', { class: 'min-w-0 truncate' }, item.label),
              item.aside
                ? el('span', { class: 'ml-auto shrink-0 text-xs text-zinc-500' }, item.aside)
                : null,
            ),
          ),
          options.more && options.more > 0
            ? el(
                'li',
                { class: 'pl-[1.125rem] text-xs text-zinc-500' },
                `et ${options.more} autre${options.more > 1 ? 's' : ''}`,
              )
            : null,
        )
      : el('p', { class: 'text-sm text-zinc-400' }, options.empty ?? '');

  return el(
    'section',
    {
      class:
        'flex flex-col gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4',
      'aria-label': options.title,
    },
    el(
      'div',
      {},
      el('p', { class: 'text-xs text-zinc-500' }, 'Aujourd’hui'),
      el('h2', { class: 'text-lg font-semibold text-zinc-100' }, options.title),
    ),
    list,
    el('div', { class: 'flex flex-col gap-2 [&>button]:w-full' }, ...options.actions),
    ...(options.footer ?? []),
  );
}

/** Pastille du mode d'exercice d'un morceau (« Sans partition » en ambre). */
export function modeBadge(parCoeur: boolean): HTMLElement {
  return el(
    'span',
    {
      class:
        'inline-flex rounded-full border px-2 py-0.5 text-[11px] leading-4 ' +
        (parCoeur
          ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
          : 'border-zinc-700 text-zinc-300'),
    },
    parCoeur ? 'Sans partition' : 'Avec partition',
  );
}

// --- Dernières séances ------------------------------------------------------

/**
 * Lien « Dernières séances » qui déplie les dix plus récentes. Renvoie `null`
 * quand il n'y en a aucune. `state` garde l'état déplié d'un rendu à l'autre.
 */
export function historyBlock(
  lines: string[],
  state: { expanded: boolean },
): HTMLElement | null {
  if (lines.length === 0) return null;
  const slot = el('div', { class: 'flex flex-col gap-2' });
  function paint(): void {
    const toggle = el(
      'button',
      {
        type: 'button',
        class:
          'self-end text-xs text-zinc-400 underline decoration-dotted underline-offset-4 ' +
          'hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        'aria-expanded': String(state.expanded),
      },
      state.expanded ? 'Masquer les dernières séances' : 'Dernières séances',
    );
    toggle.addEventListener('click', () => {
      state.expanded = !state.expanded;
      paint();
    });
    slot.replaceChildren(
      toggle,
      ...(state.expanded
        ? [
            el(
              'ul',
              { class: 'flex flex-col gap-1 text-sm text-zinc-400' },
              ...lines.map((line) => el('li', {}, line)),
            ),
          ]
        : []),
    );
  }
  paint();
  return slot;
}

/** Date courte d'une séance : « 21 sept. ». */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Gabarit commun : en-tête, puis carte à gauche et contenu à droite dès `md`. */
export function sectionLayout(
  header: HTMLElement,
  card: HTMLElement,
  content: HTMLElement,
): HTMLElement {
  return el(
    'div',
    { class: 'mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 md:py-8' },
    header,
    el(
      'div',
      { class: 'grid gap-6 md:grid-cols-[20rem_minmax(0,1fr)] md:items-start md:gap-7' },
      // Collante sur desktop : la carte reste visible pendant qu'on fait
      // défiler la liste à côté.
      el('div', { class: 'md:sticky md:top-6' }, card),
      content,
    ),
  );
}


// --- Suppression d'une setlist ------------------------------------------------

/**
 * Bouton « Supprimer la setlist » des modales d'édition, avec confirmation
 * en place : la suppression a quitté la page pour la modale, qui est l'objet
 * qu'elle détruit.
 */
export function deleteControl(name: () => string, onConfirm: () => void): HTMLElement {
  const slot = el('div', { class: 'mr-auto flex flex-wrap items-center gap-2' });
  const linkClass =
    'min-h-11 px-1 text-sm text-rose-300/90 hover:text-rose-200 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-rose-400';

  function idle(): void {
    const ask = el('button', { type: 'button', class: linkClass }, 'Supprimer la setlist');
    ask.addEventListener('click', confirm);
    slot.replaceChildren(ask);
  }

  function confirm(): void {
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
    yes.addEventListener('click', onConfirm);
    const no = el(
      'button',
      { type: 'button', class: 'min-h-11 px-2 text-sm text-zinc-400 hover:text-zinc-200' },
      'Garder',
    );
    no.addEventListener('click', idle);
    slot.replaceChildren(
      el('span', { class: 'text-xs text-zinc-400' }, `Supprimer « ${name()} » ?`),
      yes,
      no,
    );
    yes.focus();
  }

  idle();
  return slot;
}

/**
 * Entrée enregistre la modale — sauf sur un bouton, dont c'est déjà
 * l'activation (Annuler, Supprimer…) : sans cette garde, Entrée sur
 * « Annuler » enregistrait quand même.
 */
export function enterSaves(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.isComposing &&
    !(event.target instanceof HTMLElement && event.target.closest('button'))
  );
}
