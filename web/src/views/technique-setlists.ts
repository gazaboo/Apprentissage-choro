/** Modale d'édition d'une setlist de technique : nom, sélection de tonalités.
 *
 * Montée depuis le menu de la pastille de la page Technique (« Nouvelle
 * setlist », ou « Modifier » sur la ligne d'une setlist) ; la suppression se
 * fait ici.
 * Une seule setlist de technique est « active » à la fois ; créer une setlist
 * l'active aussitôt. Quand une setlist est active, `pickExercices` ne choisit
 * plus que parmi ses exercices — contrairement au filage du répertoire, il
 * n'y a ici aucun ordre de passage à fixer : le FSRS garde la main (#127).
 *
 * La sélection se fait par pastille de tonalité — même regroupement famille →
 * motif → tonalité que la vue d'ensemble (`technique-liste.ts`) — plutôt que
 * carte par carte : cocher une tonalité inclut ses cartes montant et
 * descendant ensemble.
 */

import { el, ui } from '../dom';
import { deleteTechniqueSetlist, setActiveTechniqueSetlist, upsertTechniqueSetlist } from '../store';
import type { Progress } from '../store';
import { parAccord, parFamille, parMotif } from '../technique/catalogue';
import type { ExerciceCarte } from '../technique/catalogue';
import type { TechniqueSetlist } from '../types';
import { deleteControl, enterSaves } from './section-ui';

export type TechniqueSetlistTarget =
  | { mode: 'create' }
  | { mode: 'edit'; setlist: TechniqueSetlist };

export interface TechniqueSetlistEditorOptions {
  cartes: ExerciceCarte[];
  progress: Progress;
  target: TechniqueSetlistTarget;
  /** Rappelé après enregistrement ou fermeture — l'appelant se redessine. */
  onClose: () => void;
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm ' +
  'text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400';

const CHIP_BASE =
  'inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-3 text-sm ' +
  'font-medium transition hover:border-zinc-500 focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-amber-400';
const CHIP_SELECTED = 'border-amber-400/60 bg-amber-400/15 text-amber-100';
const CHIP_UNSELECTED = 'border-zinc-700 bg-zinc-800/60 text-zinc-400';

/** Ouvre la modale. Retourne une fonction qui la retire sans rien enregistrer. */
export function openTechniqueSetlistEditor(
  options: TechniqueSetlistEditorOptions,
): () => void {
  const { cartes, progress, target, onClose } = options;
  const editing = target.mode === 'edit' ? target.setlist : null;

  const selected = new Set<string>(editing?.exerciceIds ?? []);

  const nameInput = el('input', {
    type: 'text',
    value: editing?.name ?? '',
    placeholder: 'Nom de la setlist',
    'aria-label': 'Nom de la setlist',
    class: inputClass,
  }) as HTMLInputElement;

  const countLabel = el('span', { class: 'text-xs text-zinc-500' });

  function paintCount(): void {
    countLabel.textContent = `${selected.size} exercice${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`;
  }

  // --- Grille famille / motif / tonalité, à cocher -----------------------

  const chipsById = new Map<string, HTMLButtonElement>();

  function paintChip(ids: string[]): void {
    const selectedAll = ids.every((id) => selected.has(id));
    for (const id of ids) {
      const button = chipsById.get(id);
      if (!button) continue;
      button.setAttribute('aria-checked', String(selectedAll));
      button.className = `${CHIP_BASE} ${selectedAll ? CHIP_SELECTED : CHIP_UNSELECTED}`;
    }
  }

  function toggle(ids: string[]): void {
    const selectedAll = ids.every((id) => selected.has(id));
    for (const id of ids) {
      if (selectedAll) selected.delete(id);
      else selected.add(id);
    }
    paintChip(ids);
    paintCount();
  }

  function chip(cartesAccord: ExerciceCarte[]): HTMLElement {
    const ids = cartesAccord.map((carte) => carte.id);
    const accord = cartesAccord[0]!.accord;
    const selectedAll = ids.every((id) => selected.has(id));
    const button = el(
      'button',
      {
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(selectedAll),
        class: `${CHIP_BASE} ${selectedAll ? CHIP_SELECTED : CHIP_UNSELECTED}`,
      },
      accord,
    ) as HTMLButtonElement;
    button.addEventListener('click', () => toggle(ids));
    for (const id of ids) chipsById.set(id, button);
    return button;
  }

  function motifs(group: ExerciceCarte[]): HTMLElement[] {
    return [...parMotif(group).values()].map((list) =>
      el(
        'div',
        { class: 'flex flex-col gap-2' },
        el('p', { class: 'text-sm text-zinc-300' }, list[0]?.nom ?? ''),
        el(
          'div',
          { class: 'flex flex-wrap gap-2' },
          ...[...parAccord(list).values()].map(chip),
        ),
      ),
    );
  }

  const checklist = el(
    'div',
    { class: 'flex flex-col gap-4' },
    ...[...parFamille(cartes).entries()].map(([famille, group]) =>
      el(
        'section',
        { class: 'flex flex-col gap-3' },
        el('h3', { class: 'text-sm font-medium text-zinc-100' }, famille),
        ...motifs(group),
      ),
    ),
  );

  paintCount();

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
      'aria-label': editing ? 'Modifier la setlist de technique' : 'Nouvelle setlist de technique',
    },
    el(
      'div',
      {
        class:
          'flex max-h-[85vh] w-full max-w-lg lg:max-w-2xl flex-col gap-4 rounded-2xl ' +
          'border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60',
      },
      el(
        'h2',
        { class: 'text-lg font-semibold text-zinc-100' },
        editing ? 'Modifier la setlist de technique' : 'Nouvelle setlist de technique',
      ),
      nameInput,
      el(
        'div',
        { class: 'flex items-baseline justify-between gap-3' },
        el('p', { class: ui.label }, 'Tonalités à travailler'),
        countLabel,
      ),
      el(
        'p',
        { class: 'text-xs text-zinc-500' },
        'Cochez les tonalités prioritaires (montant et descendant s’ajoutent ' +
          'ensemble). Aucun ordre de passage n’est imposé — le FSRS choisit ' +
          'quoi proposer parmi la sélection.',
      ),
      el(
        'div',
        {
          class:
            'min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-800 ' +
            'bg-zinc-900/60 p-3',
        },
        checklist,
      ),
      el(
        'div',
        { class: 'flex flex-wrap items-center justify-end gap-2' },
        editing
          ? deleteControl(
              () => nameInput.value.trim() || editing.name,
              () => {
                deleteTechniqueSetlist(progress, editing.id);
                close();
              },
            )
          : null,
        cancelButton,
        saveButton,
      ),
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
    else if (enterSaves(event)) save();
  }

  function save(): void {
    const setlist: TechniqueSetlist = {
      id: editing?.id ?? crypto.randomUUID(),
      name: nameInput.value.trim() || 'Setlist sans nom',
      exerciceIds: [...selected],
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    upsertTechniqueSetlist(progress, setlist);
    if (!editing) setActiveTechniqueSetlist(progress, setlist.id);
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
