/** Modale d'édition d'une setlist : nom, ordre de passage, sélection.
 *
 * Montée depuis le tableau de bord (bouton ＋ « nouvelle » ou ✎ « modifier »).
 * Une seule setlist est « active » à la fois ; créer une setlist l'active
 * aussitôt. Quand une setlist est active, le tableau de bord et la Session du
 * jour ne portent que sur ses morceaux — le SRS décide de l'ordre à l'intérieur.
 *
 * L'ordre de `songIds`, lui, sert au **filage** (ordre de concert). On le rend
 * modifiable ici : liste réordonnable au glisser-déposer, doublée de boutons
 * ▲▼ pour le clavier et le tactile (le drag natif ne marche pas au doigt).
 */

import { el, ui } from '../dom';
import { chevronDown, chevronUp, trash } from '../icons';
import { setActiveSetlist, upsertSetlist } from '../store';
import type { Progress } from '../store';
import type { Setlist, Song } from '../types';

export type SetlistTarget =
  | { mode: 'create' }
  | { mode: 'edit'; setlist: Setlist };

export interface SetlistEditorOptions {
  songs: Song[];
  progress: Progress;
  target: SetlistTarget;
  /** Rappelé après enregistrement ou fermeture — l'appelant se redessine. */
  onClose: () => void;
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
  'text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';

/** Ouvre la modale. Retourne une fonction qui la retire sans rien enregistrer. */
export function openSetlistEditor(options: SetlistEditorOptions): () => void {
  const { songs, progress, target, onClose } = options;
  const editing = target.mode === 'edit' ? target.setlist : null;
  const songById = new Map(songs.map((song) => [song.id, song]));

  // Source de vérité : un tableau ordonné (l'ordre de passage). Les ids
  // inconnus du manifeste sont conservés — on ne perd pas la donnée — et
  // affichés grisés, comme sur le tableau de bord.
  let order: string[] = [...new Set(editing?.songIds ?? [])];

  const nameInput = el('input', {
    type: 'text',
    value: editing?.name ?? '',
    placeholder: 'Nom de la setlist',
    'aria-label': 'Nom de la setlist',
    class: inputClass,
  }) as HTMLInputElement;

  const countLabel = el('span', { class: 'text-xs text-zinc-500' });
  const liveRegion = el('p', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
  });

  // --- Liste ordonnée (ordre de passage) ---------------------------------

  const orderList = el('ul', { class: 'flex flex-col gap-1', role: 'list' });
  const checkboxes = new Map<string, HTMLInputElement>();

  let dragId: string | null = null;

  function reorder(id: string, toIndex: number): void {
    const from = order.indexOf(id);
    if (from === -1) return;
    const clamped = Math.max(0, Math.min(order.length - 1, toIndex));
    if (from === clamped) return;
    order.splice(from, 1);
    order.splice(clamped, 0, id);
    renderOrder();
    liveRegion.textContent =
      `« ${label(id)} » déplacé en position ${clamped + 1} sur ${order.length}.`;
  }

  function move(id: string, delta: -1 | 1): void {
    const from = order.indexOf(id);
    reorder(id, from + delta);
    // Le bouton vient d'être recréé : on rend la main au clavier sur la même
    // rangée, direction de départ si elle est encore possible, sinon l'autre.
    const row = orderList.children[order.indexOf(id)] as HTMLElement | undefined;
    const wanted = delta === -1 ? 'up' : 'down';
    const btn =
      row?.querySelector<HTMLButtonElement>(`button[data-dir="${wanted}"]:not([disabled])`) ??
      row?.querySelector<HTMLButtonElement>('button[data-dir]:not([disabled])');
    btn?.focus();
  }

  function label(id: string): string {
    return songById.get(id)?.title ?? id;
  }

  function removeFromOrder(id: string): void {
    order = order.filter((entry) => entry !== id);
    const box = checkboxes.get(id);
    if (box) box.checked = false;
    renderOrder();
    liveRegion.textContent = `« ${label(id)} » retiré de la setlist.`;
  }

  function addToOrder(id: string): void {
    if (order.includes(id)) return;
    order.push(id);
    renderOrder();
    liveRegion.textContent =
      `« ${label(id)} » ajouté en position ${order.length}.`;
  }

  function orderRow(id: string, index: number): HTMLLIElement {
    const song = songById.get(id);
    const last = order.length - 1;

    const grip = el(
      'span',
      {
        class: 'grid shrink-0 grid-cols-2 gap-[3px] px-1',
        'aria-hidden': 'true',
      },
      ...Array.from({ length: 6 }, () =>
        el('span', { class: 'h-1 w-1 rounded-full bg-zinc-500' }),
      ),
    );

    const upButton = el(
      'button',
      {
        type: 'button',
        class: ui.icon,
        'data-dir': 'up',
        disabled: index === 0,
        'aria-label': `Monter « ${label(id)} »`,
      },
      chevronUp(),
    );
    upButton.addEventListener('click', () => move(id, -1));

    const downButton = el(
      'button',
      {
        type: 'button',
        class: ui.icon,
        'data-dir': 'down',
        disabled: index === last,
        'aria-label': `Descendre « ${label(id)} »`,
      },
      chevronDown(),
    );
    downButton.addEventListener('click', () => move(id, 1));

    const removeButton = el(
      'button',
      {
        type: 'button',
        class: ui.icon,
        'aria-label': `Retirer « ${label(id)} » de la setlist`,
      },
      trash(),
    );
    removeButton.addEventListener('click', () => removeFromOrder(id));

    const title = song
      ? el('span', { class: 'truncate text-zinc-100' }, song.title)
      : el('span', { class: 'truncate italic text-zinc-500' }, id);

    const row = el(
      'li',
      {
        class:
          'flex min-h-11 items-center gap-2 rounded-lg border border-zinc-800 ' +
          'bg-zinc-800/50 pr-1 text-sm',
        role: 'listitem',
        draggable: 'true',
        'data-id': id,
      },
      el('span', { class: 'w-6 shrink-0 text-center text-xs text-zinc-500' }, String(index + 1)),
      grip,
      el(
        'span',
        { class: 'flex min-w-0 flex-1 flex-col' },
        title,
        song?.composer
          ? el('span', { class: 'truncate text-xs text-zinc-500' }, song.composer)
          : null,
      ),
      upButton,
      downButton,
      removeButton,
    );

    const clearDropHint = (): void => {
      for (const child of orderList.children) {
        (child as HTMLElement).style.boxShadow = '';
      }
    };

    row.addEventListener('dragstart', (event) => {
      dragId = id;
      row.classList.add('opacity-50');
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      row.classList.remove('opacity-50');
      clearDropHint();
    });
    row.addEventListener('dragover', (event) => {
      if (dragId === null || dragId === id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const box = row.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      clearDropHint();
      row.style.boxShadow = after
        ? 'inset 0 -2px 0 0 #fbbf24'
        : 'inset 0 2px 0 0 #fbbf24';
    });
    row.addEventListener('dragleave', () => {
      row.style.boxShadow = '';
    });
    row.addEventListener('drop', (event) => {
      if (dragId === null || dragId === id) return;
      event.preventDefault();
      const box = row.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      let target = order.indexOf(id) + (after ? 1 : 0);
      if (order.indexOf(dragId) < target) target -= 1;
      reorder(dragId, target);
    });

    return row;
  }

  function renderOrder(): void {
    paintCount();
    if (order.length === 0) {
      orderList.replaceChildren(
        el(
          'li',
          { class: 'px-1 py-2 text-sm text-zinc-500' },
          'Aucun morceau. Cochez-en dans la liste ci-dessous.',
        ),
      );
      return;
    }
    orderList.replaceChildren(...order.map((id, index) => orderRow(id, index)));
  }

  function paintCount(): void {
    countLabel.textContent =
      `${order.length} morceau${order.length > 1 ? 'x' : ''}`;
  }

  // --- Case à cocher par morceau (ajout / retrait) ----------------------

  const checklist = el(
    'div',
    { class: 'flex flex-col gap-0.5' },
    ...songs.map((song) => {
      const checkbox = el('input', {
        type: 'checkbox',
        class: 'h-4 w-4 accent-amber-400',
      }) as HTMLInputElement;
      checkbox.checked = order.includes(song.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) addToOrder(song.id);
        else removeFromOrder(song.id);
      });
      checkboxes.set(song.id, checkbox);
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

  renderOrder();

  const saveButton = el('button', { type: 'button', class: ui.primary }, 'Enregistrer');
  const cancelButton = el('button', { type: 'button', class: ui.button }, 'Annuler');

  const overlay = el(
    'div',
    {
      class:
        'fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 ' +
        'backdrop-blur-sm',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': editing ? 'Modifier la setlist' : 'Nouvelle setlist',
    },
    el(
      'div',
      {
        class:
          'flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-2xl border ' +
          'border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60',
      },
      el(
        'h2',
        { class: 'text-lg font-semibold text-zinc-100' },
        editing ? 'Modifier la setlist' : 'Nouvelle setlist',
      ),
      nameInput,
      el(
        'div',
        { class: 'flex items-baseline justify-between gap-3' },
        el('p', { class: ui.label }, 'Ordre de passage'),
        countLabel,
      ),
      el(
        'p',
        { class: '-mt-1 text-xs text-zinc-500' },
        'Glissez une ligne, ou utilisez ▲▼, pour fixer l’ordre du filage.',
      ),
      el(
        'div',
        {
          class:
            'max-h-52 shrink-0 overflow-y-auto rounded-lg border border-zinc-800 ' +
            'bg-zinc-900/60 p-2',
        },
        orderList,
      ),
      el('p', { class: ui.label }, 'Tous les morceaux'),
      el(
        'div',
        {
          class:
            'min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 ' +
            'bg-zinc-900/60 p-2',
        },
        checklist,
      ),
      el('div', { class: 'flex justify-end gap-2' }, cancelButton, saveButton),
      liveRegion,
    ),
  );

  function dismiss(): void {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }

  function close(): void {
    dismiss();
    onClose();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
    else if (event.key === 'Enter' && !event.isComposing) save();
  }

  function save(): void {
    const setlist: Setlist = {
      id: editing?.id ?? crypto.randomUUID(),
      name: nameInput.value.trim() || 'Setlist sans nom',
      songIds: [...order],
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    upsertSetlist(progress, setlist);
    if (!editing) setActiveSetlist(progress, setlist.id);
    close();
  }

  saveButton.addEventListener('click', save);
  cancelButton.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  nameInput.focus();

  return dismiss;
}
