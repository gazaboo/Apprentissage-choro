import { afterEach, describe, expect, it } from 'vitest';
import { askSrs } from './srsModal';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('askSrs', () => {
  it('affiche une modale accessible et pré-sélectionne la note suggérée', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Carinhoso');
    // 0 indice sur 10 mesures masquées → note suggérée 5 (voir suggestGrade).
    const five = dialog.querySelector('button[aria-label="Parfait — sans aucun indice"]');
    expect(five?.className).toContain('amber');

    const skip = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!;
    skip.click();
    await expect(promise).resolves.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('« Enregistrer » résout avec la note, le tempo et les indices choisis', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 2, 10);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const gradeThree = dialog.querySelector('button[aria-label="Correct — quelques hésitations"]') as HTMLButtonElement;
    gradeThree.click();
    const fluide = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Tempo réel, fluide')!;
    fluide.click();
    const validate = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
    validate.click();

    await expect(promise).resolves.toEqual({ grade: 3, tempo: 'fluide', hints: 2 });
  });

  it('la croix annule : résout avec \'cancelled\', distinct de « Passer »', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const cancel = dialog.querySelector('button[aria-label*="Annuler"]') as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    cancel.click();

    await expect(promise).resolves.toBe('cancelled');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Échap annule la modale', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(promise).resolves.toBe('cancelled');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('un clic sur le voile annule, un clic dans la modale ne fait rien', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const overlay = document.body.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    const dialog = overlay.querySelector('[role="dialog"]') as HTMLElement;

    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();

    overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect(promise).resolves.toBe('cancelled');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('rend le détail note-à-note quand il est fourni, sous le contexte', async () => {
    const detail = document.createElement('div');
    const ligne = document.createElement('p');
    ligne.textContent = 'Passe 2, temps 4 — attendu E4, rien entendu';
    detail.append(ligne);
    const promise = askSrs('Arpège m7', 'Dm7', 0, 4, 'Travaillé à 72 BPM.', detail);

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Travaillé à 72 BPM.');
    expect(dialog.textContent).toContain('Passe 2, temps 4 — attendu E4, rien entendu');
    // Bloc scrollable : un relevé de 27 lignes ne doit pas pousser les boutons
    // de notation hors de l'écran.
    expect(dialog.querySelector('.max-h-40.overflow-y-auto')).toBeTruthy();

    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!.click();
    await promise;
  });

  it('n’ajoute aucun bloc de détail pour un morceau (appelant sans détail)', () => {
    void askSrs('Carinhoso', 'Ut', 1, 10);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.querySelector('.max-h-40')).toBeNull();
    expect(dialog.textContent).toContain('1 indice déclenché sur 10 mesures masquées.');
  });

  it('`maxSuggested` plafonne la présélection sans retirer les autres notes (#109)', async () => {
    // 0 indice sur 10 mesures masquées suggérerait normalement 5 (voir test
    // ci-dessus) : la partition rouverte via l'écran Consigne ne doit pas
    // pousser vers cette note-là.
    const promise = askSrs('Carinhoso', 'Ut', 0, 10, undefined, undefined, 3);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const three = dialog.querySelector('button[aria-label="Correct — quelques hésitations"]');
    expect(three?.className).toContain('bg-amber-400/15');
    const five = dialog.querySelector('button[aria-label="Parfait — sans aucun indice"]') as HTMLButtonElement;
    expect(five.className).not.toContain('bg-amber-400/15');

    // Le plafond ne bloque que la présélection : l'utilisateur choisit encore 5 à la main.
    five.click();
    const validate = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
    validate.click();
    await expect(promise).resolves.toMatchObject({ grade: 5 });
  });
});
