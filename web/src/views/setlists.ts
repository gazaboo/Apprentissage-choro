/** Gestion des setlists : sous-ensembles du répertoire à travailler sur une
 * période (préparation de concert).
 *
 * Une seule setlist est « active » à la fois. Quand elle l'est, le tableau de
 * bord et la Session du jour ne portent que sur ses morceaux — le SRS continue
 * de décider de l'ordre à l'intérieur.
 */

import { el, ui } from '../dom';
import {
  activeSetlist,
  deleteSetlist,
  setActiveSetlist,
  upsertSetlist,
} from '../store';
import type { Progress } from '../store';
import type { Setlist, Song } from '../types';

export interface SetlistsContext {
  progress: Progress;
  navigateHome: () => void;
}

/** Brouillon d'édition, distinct de la setlist enregistrée. */
interface Draft {
  /** `null` pour une création. */
  id: string | null;
  name: string;
  from: string;
  to: string;
  songIds: Set<string>;
}

const inputClass =
  'min-h-11 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
  'text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';

export function renderSetlists(
  root: HTMLElement,
  songs: Song[],
  context: SetlistsContext,
): () => void {
  const { progress } = context;
  const songById = new Map(songs.map((song) => [song.id, song]));

  let draft: Draft | null = null;
  let confirmingDelete: string | null = null;

  const list = el('div', { class: 'flex flex-col gap-4' });

  function startCreate(): void {
    draft = { id: null, name: '', from: '', to: '', songIds: new Set() };
    confirmingDelete = null;
    paint();
  }

  function startEdit(setlist: Setlist): void {
    draft = {
      id: setlist.id,
      name: setlist.name,
      from: setlist.from ?? '',
      to: setlist.to ?? '',
      songIds: new Set(setlist.songIds),
    };
    confirmingDelete = null;
    paint();
  }

  function saveDraft(): void {
    if (!draft) return;
    const previous = progress.setlists.find((entry) => entry.id === draft?.id);
    const setlist: Setlist = {
      id: draft.id ?? crypto.randomUUID(),
      name: draft.name.trim() || 'Setlist sans nom',
      songIds: [...draft.songIds],
      from: draft.from || null,
      to: draft.to || null,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    };
    upsertSetlist(progress, setlist);
    draft = null;
    paint();
  }

  function setlistCard(setlist: Setlist, isActive: boolean): HTMLElement {
    const known = setlist.songIds.filter((id) => songById.has(id)).length;
    const missing = setlist.songIds.length - known;
    const dates =
      setlist.from || setlist.to
        ? `${setlist.from ?? '…'} → ${setlist.to ?? '…'}`
        : null;

    const activateButton = el(
      'button',
      { type: 'button', class: isActive ? ui.buttonActive : ui.button },
      isActive ? 'Désactiver' : 'Activer',
    );
    activateButton.addEventListener('click', () => {
      setActiveSetlist(progress, isActive ? null : setlist.id);
      paint();
    });

    const editButton = el('button', { type: 'button', class: ui.button }, 'Modifier');
    editButton.addEventListener('click', () => startEdit(setlist));

    const deleteButton = el(
      'button',
      { type: 'button', class: ui.button },
      confirmingDelete === setlist.id ? 'Confirmer la suppression' : 'Supprimer',
    );
    deleteButton.addEventListener('click', () => {
      if (confirmingDelete === setlist.id) {
        deleteSetlist(progress, setlist.id);
        confirmingDelete = null;
      } else {
        confirmingDelete = setlist.id;
      }
      paint();
    });

    return el(
      'div',
      { class: `${ui.card} flex flex-col gap-3` },
      el(
        'div',
        { class: 'flex flex-wrap items-baseline justify-between gap-2' },
        el('h3', { class: 'text-lg font-medium text-zinc-100' }, setlist.name),
        isActive
          ? el(
              'span',
              {
                class:
                  'rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium ' +
                  'text-amber-200 ring-1 ring-amber-400/30',
              },
              'Active',
            )
          : null,
      ),
      el(
        'p',
        { class: 'text-sm text-zinc-400' },
        `${known} morceau${known > 1 ? 'x' : ''}` +
          (missing > 0 ? ` · ${missing} introuvable${missing > 1 ? 's' : ''}` : '') +
          (dates ? ` · ${dates}` : ''),
      ),
      el(
        'div',
        { class: 'flex flex-wrap gap-2' },
        activateButton,
        editButton,
        deleteButton,
      ),
    );
  }

  function formCard(): HTMLElement {
    const current = draft!;

    const nameInput = el('input', {
      type: 'text',
      value: current.name,
      placeholder: 'Nom de la setlist',
      'aria-label': 'Nom de la setlist',
      class: inputClass,
    }) as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      current.name = nameInput.value;
    });

    const fromInput = el('input', {
      type: 'date',
      value: current.from,
      'aria-label': 'Date de début (indicative)',
      class: inputClass,
    }) as HTMLInputElement;
    fromInput.addEventListener('input', () => {
      current.from = fromInput.value;
    });

    const toInput = el('input', {
      type: 'date',
      value: current.to,
      'aria-label': 'Date de fin (indicative)',
      class: inputClass,
    }) as HTMLInputElement;
    toInput.addEventListener('input', () => {
      current.to = toInput.value;
    });

    const countLabel = el(
      'span',
      { class: 'text-xs text-zinc-500' },
      `${current.songIds.size} sélectionné${current.songIds.size > 1 ? 's' : ''}`,
    );

    const checklist = el(
      'div',
      {
        class:
          'flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-lg border ' +
          'border-zinc-800 bg-zinc-900/60 p-2',
      },
      ...songs.map((song) => {
        const checkbox = el('input', {
          type: 'checkbox',
          class: 'h-4 w-4 accent-amber-400',
        }) as HTMLInputElement;
        checkbox.checked = current.songIds.has(song.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) current.songIds.add(song.id);
          else current.songIds.delete(song.id);
          countLabel.textContent = `${current.songIds.size} sélectionné${
            current.songIds.size > 1 ? 's' : ''
          }`;
        });
        return el(
          'label',
          {
            class:
              'flex min-h-11 items-center gap-3 rounded px-2 text-sm ' +
              'text-zinc-200 hover:bg-zinc-800/60',
          },
          checkbox,
          el('span', { class: 'flex-1' }, song.title),
          el('span', { class: 'text-xs text-zinc-500' }, song.composer || ''),
        );
      }),
    );

    const saveButton = el('button', { type: 'button', class: ui.primary }, 'Enregistrer');
    saveButton.addEventListener('click', saveDraft);
    const cancelButton = el('button', { type: 'button', class: ui.button }, 'Annuler');
    cancelButton.addEventListener('click', () => {
      draft = null;
      paint();
    });

    return el(
      'div',
      { class: `${ui.card} flex flex-col gap-3` },
      el(
        'h3',
        { class: 'text-lg font-medium text-zinc-100' },
        current.id ? 'Modifier la setlist' : 'Nouvelle setlist',
      ),
      nameInput,
      el(
        'div',
        { class: 'flex flex-wrap items-center gap-2 text-xs text-zinc-500' },
        el('span', {}, 'Du'),
        fromInput,
        el('span', {}, 'au'),
        toInput,
        el('span', {}, '(indicatif)'),
      ),
      el(
        'div',
        { class: 'flex items-center justify-between' },
        el('p', { class: ui.label }, 'Morceaux'),
        countLabel,
      ),
      checklist,
      el('div', { class: 'flex flex-wrap gap-2' }, saveButton, cancelButton),
    );
  }

  function paint(): void {
    const active = activeSetlist(progress);
    const ordered = [...progress.setlists].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const rows: HTMLElement[] = [];

    if (ordered.length === 0 && !draft) {
      rows.push(
        el(
          'p',
          { class: 'text-sm text-zinc-500' },
          'Aucune setlist pour l’instant. Créez-en une pour cadrer une période ' +
            'de travail — le reste du répertoire restera accessible.',
        ),
      );
    }

    for (const setlist of ordered) {
      rows.push(
        draft && draft.id === setlist.id
          ? formCard()
          : setlistCard(setlist, active?.id === setlist.id),
      );
    }

    if (draft && draft.id === null) rows.push(formCard());

    if (!draft) {
      const addButton = el(
        'button',
        { type: 'button', class: ui.primary },
        '+ Nouvelle setlist',
      );
      addButton.addEventListener('click', startCreate);
      rows.push(addButton);
    }

    list.replaceChildren(...rows);
  }

  const backButton = el('button', { type: 'button', class: ui.button }, 'Retour au répertoire');
  backButton.addEventListener('click', context.navigateHome);

  root.replaceChildren(
    el(
      'div',
      { class: 'mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8' },
      el(
        'header',
        { class: 'flex flex-wrap items-start justify-between gap-4' },
        el(
          'div',
          {},
          el('h1', { class: 'text-2xl font-semibold text-zinc-100' }, 'Setlists'),
          el(
            'p',
            { class: 'mt-1 max-w-xl text-sm text-zinc-400' },
            'Choisissez les morceaux à travailler pour un concert. La setlist ' +
              'active restreint le tableau de bord et la Session du jour.',
          ),
        ),
        backButton,
      ),
      list,
    ),
  );

  paint();
  return () => {};
}
