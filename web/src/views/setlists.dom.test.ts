import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSetlistEditor, type SetlistEditorOptions } from './setlists';
import type { Progress } from '../store';
import type { Setlist, Song } from '../types';

function song(id: string, title = id): Song {
  return {
    id,
    title,
    composer: '',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 1, measure_count: 1, pages: [] }],
    contraponto: null,
  };
}

function baseProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    techniqueSetlists: [],
    activeTechniqueSetlistId: null,
    techniquePresetsSeeded: false,
    sessions: [],
    _rev: 0,
    settings: {
      blockMinutes: 5,
      display: 'partition',
      studyMode: 'mesures',
      maskLevel: 50,
      maskSeed: 1,
      eclipseIntensity: 'moyennes',
      instrumentDefault: 'c',
      contrechant: 'sans',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
    },
    ...overrides,
  };
}

let dismiss: (() => void) | null = null;

function open(overrides: Partial<SetlistEditorOptions> = {}) {
  const onClose = vi.fn();
  const options: SetlistEditorOptions = {
    songs: [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Charlie')],
    progress: baseProgress(),
    target: { mode: 'create' },
    onClose,
    ...overrides,
  };
  dismiss = openSetlistEditor(options);
  const overlay = document.body.querySelector('[role="dialog"]') as HTMLElement;
  return { overlay, onClose, progress: options.progress };
}

afterEach(() => {
  // Le seul listener posé hors du DOM (keydown sur `document`) : le retirer
  // explicitement, `setup.dom.ts` ne vide que `document.body`.
  dismiss?.();
  dismiss = null;
});

function findButton(overlay: HTMLElement, label: string): HTMLButtonElement {
  const button = [...overlay.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`bouton "${label}" introuvable`);
  return button;
}

describe('openSetlistEditor — smoke', () => {
  it('ouvre une modale accessible (`role="dialog"`)', () => {
    const { overlay } = open();
    expect(overlay).toBeTruthy();
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(overlay.getAttribute('aria-label')).toBe('Nouvelle setlist');
  });

  it('mode édition : le titre change et le nom est pré-rempli', () => {
    const setlist: Setlist = { id: 's1', name: 'Concert du 12', songIds: ['a'], createdAt: '2026-01-01T00:00:00Z' };
    const { overlay } = open({ target: { mode: 'edit', setlist } });
    expect(overlay.getAttribute('aria-label')).toBe('Modifier la setlist');
    expect((overlay.querySelector('input[aria-label="Nom de la setlist"]') as HTMLInputElement).value).toBe(
      'Concert du 12',
    );
  });
});

describe('openSetlistEditor — ajout / retrait via la case à cocher', () => {
  it('cocher un morceau l\'ajoute à l\'ordre de passage, décocher le retire', () => {
    const { overlay } = open();
    const checkboxes = [...overlay.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const alphaCheckbox = checkboxes[0]!;

    alphaCheckbox.checked = true;
    alphaCheckbox.dispatchEvent(new Event('change'));
    expect(overlay.querySelector('[role="list"]')?.textContent).toContain('Alpha');
    expect(overlay.textContent).toContain('1 morceau');

    alphaCheckbox.checked = false;
    alphaCheckbox.dispatchEvent(new Event('change'));
    expect(overlay.querySelector('[role="list"]')?.textContent).not.toContain('Alpha');
    expect(overlay.textContent).toContain('0 morceau');
  });
});

describe('openSetlistEditor — réorganisation via ▲▼', () => {
  it('descendre le premier morceau le place en deuxième position', () => {
    const setlist: Setlist = {
      id: 's1',
      name: 'Concert',
      songIds: ['a', 'b', 'c'],
      createdAt: '2026-01-01T00:00:00Z',
    };
    const { overlay } = open({ target: { mode: 'edit', setlist } });

    const firstRow = overlay.querySelector('[role="listitem"]') as HTMLElement;
    const downButton = firstRow.querySelector('button[data-dir="down"]') as HTMLButtonElement;
    downButton.click();

    const rowsAfter = [...overlay.querySelectorAll('[role="listitem"]')];
    expect(rowsAfter[0]!.getAttribute('data-id')).toBe('b');
    expect(rowsAfter[1]!.getAttribute('data-id')).toBe('a');
    expect(rowsAfter[2]!.getAttribute('data-id')).toBe('c');
  });

  it('retirer un morceau via la corbeille le sort de l\'ordre', () => {
    const setlist: Setlist = {
      id: 's1',
      name: 'Concert',
      songIds: ['a', 'b'],
      createdAt: '2026-01-01T00:00:00Z',
    };
    const { overlay } = open({ target: { mode: 'edit', setlist } });
    const removeButton = overlay.querySelector(
      'button[aria-label="Retirer « Alpha » de la setlist"]',
    ) as HTMLButtonElement;
    removeButton.click();
    const rows = [...overlay.querySelectorAll('[role="listitem"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-id')).toBe('b');
  });
});

describe('openSetlistEditor — enregistrement et fermeture', () => {
  it('« Enregistrer » persiste la setlist et active une nouvelle setlist créée', () => {
    const { overlay, onClose, progress } = open();
    const nameInput = overlay.querySelector('input[aria-label="Nom de la setlist"]') as HTMLInputElement;
    nameInput.value = 'Ma setlist';
    nameInput.dispatchEvent(new Event('input'));

    const checkbox = overlay.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));

    findButton(overlay, 'Enregistrer').click();

    expect(progress.setlists).toHaveLength(1);
    expect(progress.setlists[0]!.name).toBe('Ma setlist');
    expect(progress.setlists[0]!.songIds).toEqual(['a']);
    expect(progress.activeSetlistId).toBe(progress.setlists[0]!.id);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('« Annuler » ferme sans enregistrer', () => {
    const { overlay, onClose, progress } = open();
    findButton(overlay, 'Annuler').click();
    expect(progress.setlists).toHaveLength(0);
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Échap ferme la modale', () => {
    const { onClose } = open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('openSetlistEditor — suppression', () => {
  const existing: Setlist = {
    id: 's1',
    name: 'Roda du jeudi',
    songIds: ['a'],
    createdAt: '2026-01-01',
  };

  it('pas de suppression à la création', () => {
    const { overlay } = open();
    expect(overlay.textContent).not.toContain('Supprimer la setlist');
  });

  it('demande confirmation, puis supprime la setlist et ferme la modale', () => {
    const progress = baseProgress({ setlists: [existing], activeSetlistId: 's1' });
    const { overlay, onClose } = open({ progress, target: { mode: 'edit', setlist: existing } });
    findButton(overlay, 'Supprimer la setlist').click();
    expect(overlay.textContent).toContain('Supprimer « Roda du jeudi » ?');
    expect(progress.setlists).toHaveLength(1);
    findButton(overlay, 'Supprimer').click();
    expect(progress.setlists).toHaveLength(0);
    expect(progress.activeSetlistId).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('« Garder » annule la confirmation', () => {
    const progress = baseProgress({ setlists: [existing] });
    const { overlay } = open({ progress, target: { mode: 'edit', setlist: existing } });
    findButton(overlay, 'Supprimer la setlist').click();
    findButton(overlay, 'Garder').click();
    expect(progress.setlists).toHaveLength(1);
    expect(findButton(overlay, 'Supprimer la setlist')).toBeTruthy();
  });

  it('Entrée sur un bouton l’active sans enregistrer la modale', () => {
    const progress = baseProgress({ setlists: [existing] });
    const { overlay, onClose } = open({ progress, target: { mode: 'edit', setlist: existing } });
    const cancel = findButton(overlay, 'Annuler');
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
