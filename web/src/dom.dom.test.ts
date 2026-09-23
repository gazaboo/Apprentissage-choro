/** Primitives de contrôle partagées (`dom.ts`).
 *
 * La pastille de transposition et le groupe segmenté vivaient dans
 * `transport.ts` et `trainer.ts`, chacun en double exemplaire. Les tests de
 * cycle de tonalité qui couvraient le transport ont suivi la pastille ici
 * (#137).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createPlayerDock,
  createSegmented,
  createSkipButton,
  createSourceToggle,
  createTopBarIdentity,
  createTopBarMenu,
  el,
  menuSection,
  renderRateStepper,
} from './dom';

describe('createTopBarMenu', () => {
  function mount() {
    const trigger = el('button', { type: 'button' }, 'Affichage');
    const inside = el('button', { type: 'button' }, 'Grille');
    const menu = createTopBarMenu({ trigger, label: 'Affichage', content: [menuSection('Vue', inside)] });
    document.body.append(menu.root);
    return { trigger, inside, menu };
  }

  it('s\'ouvre au toucher, reste ouvert quand on y choisit, et se ferme dehors ou à Échap (#153)', () => {
    const { trigger, inside, menu } = mount();
    expect(menu.panel.classList.contains('hidden')).toBe(true);
    trigger.click();
    expect(menu.panel.classList.contains('hidden')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    inside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.panel.classList.contains('hidden')).toBe(false);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.panel.classList.contains('hidden')).toBe(true);

    trigger.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.panel.classList.contains('hidden')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    menu.root.remove();
  });

  it('nomme le panneau et en titre les rubriques', () => {
    const { menu } = mount();
    expect(menu.panel.getAttribute('role')).toBe('dialog');
    expect(menu.panel.getAttribute('aria-label')).toBe('Affichage');
    expect(menu.panel.querySelector('h3')?.textContent).toBe('Vue');
    menu.root.remove();
  });
});

describe('createTopBarIdentity', () => {
  it('garde un vrai titre de page et ouvre son panneau de contexte (#153)', () => {
    const action = el('button', { type: 'button' }, 'Terminer la séance');
    const identity = createTopBarIdentity({
      caption: ['Urgences', el('span', {}, ' · 2 sur 3')],
      title: 'Benzinho',
      subtitle: '· Jacob do Bandolim',
      panelLabel: 'Benzinho',
      panel: [action],
    });
    document.body.append(identity.root);
    // Le titre n'est pas dans le bouton : `h1` seul, lu tel quel.
    expect(identity.root.querySelector('h1')?.textContent).toBe('Benzinho');
    expect(identity.root.querySelector('button h1')).toBeNull();
    expect(identity.root.textContent).toContain('Urgences · 2 sur 3');

    const panel = identity.root.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.classList.contains('hidden')).toBe(true);
    (identity.root.querySelector('button.identity-hit') as HTMLButtonElement).click();
    expect(panel.classList.contains('hidden')).toBe(false);
    identity.setOpen(false);
    expect(panel.classList.contains('hidden')).toBe(true);
    identity.root.remove();
  });

  it('remplace la légende et le titre au changement de morceau', () => {
    const identity = createTopBarIdentity({ caption: ['Filage'], title: 'A', panelLabel: 'Filage', panel: [] });
    identity.setCaption(['Filage', el('span', {}, ' · 2 sur 3')]);
    identity.title.textContent = 'B';
    expect(identity.root.textContent).toContain('Filage · 2 sur 3');
    expect(identity.title.textContent).toBe('B');
  });
});

describe('createSegmented', () => {
  const options = [
    { value: 'partition' as const, label: 'Partition' },
    { value: 'grille' as const, label: 'Grille' },
  ];

  it('rappelle la vue au clic sans décider seul de la sélection', () => {
    const onPick = vi.fn();
    const seg = createSegmented(options, onPick);
    seg.set('partition');

    const grille = [...seg.root.querySelectorAll('button')].find((b) => b.textContent === 'Grille')!;
    grille.click();

    expect(onPick).toHaveBeenCalledWith('grille');
    // La vue reste seule source de vérité : tant qu'elle n'a pas appelé
    // `set`, la sélection peinte n'a pas bougé — c'est ce qui lui permet de
    // refuser un choix (grille pas encore chargée) ou d'en imposer un autre.
    expect(grille.dataset.state).toBe('off');

    seg.set('grille');
    expect(grille.dataset.state).toBe('on');
  });

  it('marque l\'état hors du style, pour que la palette puisse changer', () => {
    const seg = createSegmented(options, vi.fn());
    seg.set('grille');
    const states = [...seg.root.querySelectorAll('button')].map((b) => b.dataset.state);
    expect(states).toEqual(['off', 'on']);
  });

  it('se masque entièrement quand la bascule n\'a pas lieu d\'être', () => {
    const seg = createSegmented(options, vi.fn());
    seg.setVisible(false);
    expect(seg.root.classList.contains('hidden')).toBe(true);
    seg.setVisible(true);
    expect(seg.root.classList.contains('hidden')).toBe(false);
  });
});

describe('createPlayerDock', () => {
  it('place la piste seule en tête, puis lecture et réglages sur une rangée', () => {
    const seek = el('div', {}, 'piste');
    const play = el('button', {}, 'lecture');
    const back = el('button', {}, '-5');
    const settings = el('button', {}, 'bande');
    const dock = createPlayerDock({ seek, transport: [back, play], settings: [settings] });

    // Sous 768 px, la piste a sa propre rangée, pleine largeur : aucun autre
    // contrôle ne la partage (#153, variante A).
    const [seekRow, controlsRow] = [...dock.children] as HTMLElement[];
    expect(seekRow!.contains(seek)).toBe(true);
    expect(seekRow!.contains(play)).toBe(false);
    expect(controlsRow!.contains(play)).toBe(true);
    expect(controlsRow!.contains(settings)).toBe(true);
    // Lecture à gauche, réglages à droite.
    expect(play.parentElement!.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('createSkipButton', () => {
  it('annonce et transmet le décalage signé', () => {
    const onSkip = vi.fn();
    const back = createSkipButton({ direction: -1, seconds: 5, onSkip });
    const forward = createSkipButton({ direction: 1, seconds: 5, onSkip });
    expect(back.getAttribute('aria-label')).toBe('Reculer de 5 secondes');
    expect(forward.getAttribute('aria-label')).toBe('Avancer de 5 secondes');

    back.click();
    expect(onSkip).toHaveBeenLastCalledWith(-5);
    forward.click();
    expect(onSkip).toHaveBeenLastCalledWith(5);
  });
});

describe('createSourceToggle', () => {
  it('se légende « Bande » sur mobile, pas d\'une icône seule', () => {
    const toggle = createSourceToggle({ available: ['reference', 'playback'], current: 'reference', onPick: vi.fn() });
    expect(toggle.root.textContent).toContain('Bande');
    expect(toggle.root.textContent).toContain('Original');
    toggle.root.click();
    expect(toggle.root.textContent).toContain('Playback');
  });
});

describe('renderRateStepper — pastille mobile', () => {
  function fakePlayer(initial = 1) {
    let rate = initial;
    return {
      setRate: vi.fn((next: number) => (rate = Math.min(1, Math.max(0.5, next)))),
      getRate: () => rate,
    };
  }
  const popoverOf = (compact: HTMLElement) => compact.querySelector<HTMLElement>('[role="dialog"]')!;

  it('dit la vitesse en pourcentage et s\'ouvre en panneau', () => {
    const player = fakePlayer();
    const stepper = renderRateStepper(player);
    document.body.append(stepper.compact);
    const opener = stepper.compact.querySelector('button')!;

    expect(opener.textContent).toContain('Vitesse');
    expect(opener.textContent).toContain('100 %');
    expect(popoverOf(stepper.compact).classList.contains('hidden')).toBe(true);

    opener.click();
    expect(popoverOf(stepper.compact).classList.contains('hidden')).toBe(false);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    stepper.compact.remove();
  });

  it('applique un palier et repeint les deux variantes du stepper', () => {
    const player = fakePlayer();
    const stepper = renderRateStepper(player);
    const preset = [...popoverOf(stepper.compact).querySelectorAll('button')].find((b) => b.textContent === '70 %')!;

    preset.click();
    expect(player.setRate).toHaveBeenLastCalledWith(0.7);
    expect(stepper.compact.querySelector('button')!.textContent).toContain('70 %');
    // Le stepper desktop suit le même état.
    expect(stepper.value.textContent).toBe('0,7×');
    expect(preset.dataset.state).toBe('on');
  });

  it('se referme au toucher hors du panneau', () => {
    const stepper = renderRateStepper(fakePlayer());
    document.body.append(stepper.compact);
    const opener = stepper.compact.querySelector('button')!;
    opener.click();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(popoverOf(stepper.compact).classList.contains('hidden')).toBe(true);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    stepper.compact.remove();
  });

  it('affiche des paliers en BPM quand le tempo est connu', () => {
    const stepper = renderRateStepper(fakePlayer(), { getBpm: () => 120 });
    const labels = [...popoverOf(stepper.compact).querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('60');
    expect(labels).toContain('120');
    // Légende « Tempo », valeur sans unité : la rangée mobile est comptée.
    const opener = stepper.compact.querySelector('button')!;
    expect(opener.textContent).toContain('Tempo');
    expect(opener.textContent).toContain('120');
    expect(opener.textContent).not.toContain('BPM');
  });
});
