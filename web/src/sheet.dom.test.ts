/** Caractérisation de l'habillage du dock, avant la refonte #137.
 *
 * Comme `transport.dom.test.ts`, ces tests figent l'existant plutôt qu'ils
 * ne le corrigent : la refonte doit sortir le dock du recouvrement et
 * remonter l'ouvreur du Défi dans la barre du haut sans rien casser de ce
 * qui suit. `sheet.ts` n'avait aucun test propre.
 */

import { describe, expect, it, vi } from 'vitest';

import { createControlBar, type ControlBarOptions } from './sheet';
import { el } from './dom';
import type { Section } from './transport';

/**
 * `matchMedia` contrôlable : `sheet.ts` s'abonne à l'événement `change` pour
 * redistribuer ses nœuds au franchissement des 768 px. La doublure de
 * `test/setup.dom.ts` répond toujours « mobile » et n'émet jamais — il faut
 * donc la remplacer pour couvrir le versant desktop et la bascule.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    get matches() {
      return matches;
    },
    media: '(min-width: 768px)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    dispatchEvent: () => false,
  };
  window.matchMedia = () => list as unknown as MediaQueryList;
  return {
    cross(next: boolean): void {
      matches = next;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
  };
}

function section(title: string): Section {
  return { title, hint: `À quoi sert ${title}`, body: el('p', {}, `corps de ${title}`) };
}

function mount(overrides: Partial<ControlBarOptions> = {}) {
  const onPanelMoved = vi.fn();
  const bar = createControlBar({
    primary: el('div', { 'data-primary': '' }, 'commandes'),
    sections: [section('Défi')],
    panelPosition: null,
    onPanelMoved,
    ...overrides,
  });
  document.body.appendChild(bar.root);
  return { bar, onPanelMoved };
}

const panel = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const overlay = () => panel().parentElement as HTMLElement;
const openerLarge = () =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Défi'))!;
const openerSmall = () =>
  document.body.querySelector('button[aria-label="Ouvrir le défi"]') as HTMLButtonElement;

function pointer(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 });
}

describe('createControlBar — structure', () => {
  it('accueille les commandes du transport telles quelles', () => {
    const primary = el('div', { 'data-primary': '' }, 'commandes');
    const { bar } = mount({ primary });
    expect(bar.root.querySelector('[data-primary]')).toBe(primary);
  });

  it('pose le panneau sur `document.body`, hors du dock retourné', () => {
    const { bar } = mount();
    // Pièges pour les tests de vues : le panneau porte lui aussi
    // `role="dialog"`, et il ne vit pas dans l'arbre de la vue.
    expect(bar.root.contains(panel())).toBe(false);
    expect(document.body.contains(panel())).toBe(true);
    expect(panel().getAttribute('aria-label')).toBe('Défi');
  });

  it('rend chaque section avec son intitulé et son explication', () => {
    const { bar } = mount({ sections: [section('Défi'), section('Répéter un passage')] });
    const titles = [...panel().querySelectorAll('h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Défi', 'Répéter un passage']);
    expect(panel().textContent).toContain('À quoi sert Répéter un passage');
    expect(bar.root.textContent).not.toContain('À quoi sert Défi');
  });

  it('place le bouton de repli optionnel dans le dock', () => {
    const foldButton = el('button', { 'data-fold': '' }, '▾');
    const { bar } = mount({ foldButton });
    expect(bar.root.contains(foldButton)).toBe(true);
  });
});

describe('createControlBar — ouverture du Défi', () => {
  it('part fermé et s\'ouvre au clic, `aria-expanded` suivant l\'état', () => {
    mount();
    expect(overlay().style.display).toBe('none');
    expect(openerSmall().getAttribute('aria-expanded')).toBe('false');

    openerSmall().click();
    expect(overlay().style.display).not.toBe('none');
    expect(openerSmall().getAttribute('aria-expanded')).toBe('true');

    openerSmall().click();
    expect(overlay().style.display).toBe('none');
    expect(openerSmall().getAttribute('aria-expanded')).toBe('false');
  });

  it('referme par le bouton de fermeture du panneau', () => {
    mount();
    openerSmall().click();
    const close = panel().querySelector(
      'button[aria-label="Fermer le défi"]',
    ) as HTMLButtonElement;
    close.click();
    expect(overlay().style.display).toBe('none');
  });

  it('masque l\'ouvreur quand il n\'y a aucun réglage à montrer', () => {
    mount({ sections: [] });
    // `classList.contains` et non `className.toContain` : la classe
    // `md:hidden` que l'ouvreur porte en permanence contient le mot
    // « hidden », et rendrait l'assertion toujours vraie.
    expect(openerSmall().classList.contains('hidden')).toBe(true);
    const slot = openerLarge().parentElement as HTMLElement;
    expect(slot.classList.contains('md:hidden')).toBe(true);
  });
});

describe('createControlBar — petit écran (< 768 px)', () => {
  it('assombrit le fond et colle le panneau en bas', () => {
    mount();
    openerSmall().click();
    expect(overlay().style.display).toBe('flex');
    expect(overlay().className).toContain('bg-zinc-950/70');
    expect(panel().className).toContain('rounded-b-none');
    expect(panel().className).not.toContain('fixed');
  });

  it('referme quand on touche à côté du panneau', () => {
    mount();
    openerSmall().click();
    overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay().style.display).toBe('none');
  });

  it('ne déplace pas le panneau : il n\'y a nulle part où le mettre', () => {
    const { onPanelMoved } = mount();
    openerSmall().click();
    const header = panel().querySelector('.panel-header') as HTMLElement;
    header.dispatchEvent(pointer('pointerdown', 100, 100));
    header.dispatchEvent(pointer('pointermove', 300, 250));
    header.dispatchEvent(pointer('pointerup', 300, 250));
    expect(onPanelMoved).not.toHaveBeenCalled();
  });
});

describe('createControlBar — grand écran (≥ 768 px)', () => {
  it('ouvre un popover flottant qui laisse la partition visible', () => {
    stubMatchMedia(true);
    mount();
    openerLarge().click();
    expect(overlay().style.display).toBe('block');
    expect(overlay().className).toContain('pointer-events-none');
    expect(panel().className).toContain('fixed');
    expect(panel().style.width).toBe('360px');
  });

  it('ne referme pas sur un clic hors panneau : la partition est cliquable', () => {
    stubMatchMedia(true);
    mount();
    openerLarge().click();
    overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay().style.display).toBe('block');
  });

  it('mémorise la position après un déplacement du popover', () => {
    stubMatchMedia(true);
    const { onPanelMoved } = mount();
    openerLarge().click();
    const header = panel().querySelector('.panel-header') as HTMLElement;

    header.dispatchEvent(pointer('pointerdown', 100, 100));
    header.dispatchEvent(pointer('pointermove', 300, 250));
    expect(panel().style.left).toBe('200px');
    header.dispatchEvent(pointer('pointerup', 300, 250));

    expect(onPanelMoved).toHaveBeenCalledWith({ x: 200, y: 150 });
  });

  it('ramène dans la fenêtre une position héritée d\'un plus grand écran', () => {
    stubMatchMedia(true);
    mount({ panelPosition: { x: 9000, y: 9000 } });
    openerLarge().click();
    // `clamp` borne à `innerWidth - 360 - 8` et `innerHeight - hauteur - 8`.
    expect(parseInt(panel().style.left, 10)).toBeLessThanOrEqual(window.innerWidth - 360);
    expect(parseInt(panel().style.top, 10)).toBeLessThanOrEqual(window.innerHeight);
  });
});

describe('createControlBar — franchissement du point de rupture', () => {
  it('redistribue les mêmes nœuds et referme le panneau', () => {
    const media = stubMatchMedia(false);
    mount();
    openerSmall().click();
    const before = panel();
    expect(overlay().style.display).toBe('flex');

    media.cross(true);

    // Un seul jeu de nœuds pour les deux tailles : le panneau est déplacé,
    // pas reconstruit — ses écouteurs survivent donc au franchissement.
    expect(panel()).toBe(before);
    expect(overlay().style.display).toBe('none');
    expect(panel().className).toContain('fixed');
  });
});

describe('createControlBar — démontage', () => {
  it('retire le panneau du document', () => {
    const { bar } = mount();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    bar.destroy();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
