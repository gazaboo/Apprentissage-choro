import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_DELAY_MS, askSrs } from './srsModal';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function dialog(): HTMLElement {
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  return [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;
}

function grade(root: HTMLElement, value: number): HTMLButtonElement {
  return root.querySelector(`button[data-grade="${value}"]`) as HTMLButtonElement;
}

describe('askSrs', () => {
  it('affiche une modale accessible avec quatre notes, aucune présélectionnée ni suggérée', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const modal = dialog();
    expect(modal).toBeTruthy();
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.textContent).toContain('Carinhoso');

    const grades = [...modal.querySelectorAll<HTMLButtonElement>('button[data-grade]')];
    expect(grades.map((b) => b.dataset.grade)).toEqual(['1', '3', '4', '5']);
    expect(grades.map((b) => b.querySelector('span > span')!.textContent)).toEqual([
      'Raté',
      'Difficile',
      'Bien',
      'Facile',
    ]);
    expect(grades.every((b) => b.dataset.state === undefined)).toBe(true);
    expect(modal.textContent).not.toMatch(/suggér/i);
    // Un Entrée réflexe ne doit pas enregistrer de note : aucune n'a le focus.
    expect(grades).not.toContain(document.activeElement);

    button(modal, 'Passer sans noter').click();
    await expect(promise).resolves.toBeNull();
    expect(dialog()).toBeNull();
  });

  it('le tempo est présélectionné sur « crispé » et se change avant la note', () => {
    void askSrs('Carinhoso', 'Ut', 0, 10);
    const modal = dialog();
    expect(button(modal, 'Réel, crispé').dataset.state).toBe('on');
    button(modal, 'Réel, fluide').click();
    expect(button(modal, 'Réel, fluide').dataset.state).toBe('on');
    expect(button(modal, 'Réel, crispé').dataset.state).toBe('off');
  });

  it('un appui sur une note confirme, puis résout seul après le délai', async () => {
    vi.useFakeTimers();
    const promise = askSrs('Carinhoso', 'Ut', 2, 10);
    const modal = dialog();
    button(modal, 'Réel, fluide').click();
    grade(modal, 3).click();

    expect(modal.textContent).toContain('Enregistré : Difficile · tempo réel, fluide');
    expect(dialog()).toBeTruthy();

    vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    await expect(promise).resolves.toEqual({ grade: 3, tempo: 'fluide', hints: 2 });
    expect(dialog()).toBeNull();
  });

  it('« Continuer » résout tout de suite, sans attendre le délai', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const modal = dialog();
    grade(modal, 5).click();
    button(modal, 'Continuer').click();
    await expect(promise).resolves.toEqual({ grade: 5, tempo: 'crispe', hints: 0 });
  });

  it('« Annuler, je me suis trompé » revient au choix et arrête le délai', async () => {
    vi.useFakeTimers();
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const modal = dialog();
    grade(modal, 1).click();
    button(modal, 'Annuler, je me suis trompé de note').click();

    vi.advanceTimersByTime(CONFIRM_DELAY_MS * 2);
    expect(dialog()).toBeTruthy();
    expect(grade(modal, 4).closest('[hidden]')).toBeNull();

    grade(modal, 4).click();
    button(modal, 'Continuer').click();
    await expect(promise).resolves.toMatchObject({ grade: 4 });
  });

  it('la croix annule : résout avec \'cancelled\', distinct de « Passer sans noter »', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const cancel = dialog().querySelector('button[aria-label*="Annuler"]') as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    cancel.click();

    await expect(promise).resolves.toBe('cancelled');
    expect(dialog()).toBeNull();
  });

  it('Échap annule, y compris pendant la confirmation', async () => {
    vi.useFakeTimers();
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    grade(dialog(), 4).click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(promise).resolves.toBe('cancelled');
    expect(dialog()).toBeNull();
    // Le délai ne doit pas résoudre une seconde fois ni relancer quoi que ce soit.
    vi.advanceTimersByTime(CONFIRM_DELAY_MS);
  });

  it('un clic sur le voile annule, un clic dans la modale ne fait rien', async () => {
    const promise = askSrs('Carinhoso', 'Ut', 0, 10);
    const overlay = document.body.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    const modal = overlay.querySelector('[role="dialog"]') as HTMLElement;

    modal.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(dialog()).toBeTruthy();

    overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await expect(promise).resolves.toBe('cancelled');
    expect(dialog()).toBeNull();
  });

  it('rend le détail note-à-note quand il est fourni, sous le contexte', async () => {
    const detail = document.createElement('div');
    const ligne = document.createElement('p');
    ligne.textContent = 'Passe 2, temps 4 — attendu E4, rien entendu';
    detail.append(ligne);
    const promise = askSrs('Arpège m7', 'Dm7', 0, 4, 'Travaillé à 72 BPM.', detail);

    const modal = dialog();
    expect(modal.textContent).toContain('Travaillé à 72 BPM.');
    expect(modal.textContent).toContain('Passe 2, temps 4 — attendu E4, rien entendu');
    // Bloc scrollable : un relevé de 27 lignes ne doit pas pousser les boutons
    // de notation hors de l'écran.
    expect(modal.querySelector('.max-h-40.overflow-y-auto')).toBeTruthy();

    button(modal, 'Passer sans noter').click();
    await promise;
  });

  it('n’ajoute aucun bloc de détail pour un morceau (appelant sans détail)', () => {
    void askSrs('Carinhoso', 'Ut', 1, 10);
    const modal = dialog();
    expect(modal.querySelector('.max-h-40')).toBeNull();
    expect(modal.textContent).toContain('1 indice déclenché sur 10 mesures masquées.');
  });
});
