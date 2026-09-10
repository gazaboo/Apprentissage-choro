/** Modale d'édition d'une setlist : nom + sélection des morceaux.
 *
 * Montée depuis le tableau de bord (bouton ＋ « nouvelle » ou ✎ « modifier »).
 * Une seule setlist est « active » à la fois ; créer une setlist l'active
 * aussitôt. Quand une setlist est active, le tableau de bord et la Session du
 * jour ne portent que sur ses morceaux — le SRS décide de l'ordre à l'intérieur.
 */

import { el, ui } from '../dom';
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

  const selected = new Set<string>(editing?.songIds ?? []);

  const nameInput = el('input', {
    type: 'text',
    value: editing?.name ?? '',
    placeholder: 'Nom de la setlist',
    'aria-label': 'Nom de la setlist',
    class: inputClass,
  }) as HTMLInputElement;

  const countLabel = el('span', { class: 'text-xs text-zinc-500' });
  const paintCount = (): void => {
    countLabel.textContent = `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}`;
  };
  paintCount();

  const checklist = el(
    'div',
    { class: 'flex flex-col gap-0.5' },
    ...songs.map((song) => {
      const checkbox = el('input', {
        type: 'checkbox',
        class: 'h-4 w-4 accent-amber-400',
      }) as HTMLInputElement;
      checkbox.checked = selected.has(song.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(song.id);
        else selected.delete(song.id);
        paintCount();
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
        { class: 'flex items-center justify-between' },
        el('p', { class: ui.label }, 'Morceaux'),
        countLabel,
      ),
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
      songIds: [...selected],
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
