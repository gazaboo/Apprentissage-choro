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
});
