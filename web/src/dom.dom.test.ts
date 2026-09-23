/** Primitives de contrôle partagées (`dom.ts`).
 *
 * La pastille de transposition et le groupe segmenté vivaient dans
 * `transport.ts` et `trainer.ts`, chacun en double exemplaire. Les tests de
 * cycle de tonalité qui couvraient le transport ont suivi la pastille ici
 * (#137).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createInstrumentChip,
  createPlayerDock,
  createSegmented,
  createSkipButton,
  createSourceToggle,
  el,
  renderRateStepper,
} from './dom';
import type { InstrumentId } from './types';

const instrument = (id: InstrumentId, name: string) => ({ id, name });

describe('createInstrumentChip', () => {
  it('parcourt les transpositions en cycle et prévient la vue', () => {
    const onPick = vi.fn();
    const chip = createInstrumentChip({
      instruments: [instrument('c', 'Concert'), instrument('bb', 'Si bémol'), instrument('eb', 'Mi bémol')],
      current: 'c',
      onPick,
    });
    expect(chip.root.textContent).toContain('Ut');

    chip.root.click();
    expect(onPick).toHaveBeenLastCalledWith('bb');
    expect(chip.root.textContent).toContain('Si♭');

    chip.root.click();
    expect(onPick).toHaveBeenLastCalledWith('eb');

    chip.root.click();
    expect(onPick).toHaveBeenLastCalledWith('c');
    expect(chip.root.textContent).toContain('Ut');
  });

  it('reste affichée mais inerte quand le morceau n\'a qu\'une tonalité', () => {
    const onPick = vi.fn();
    const chip = createInstrumentChip({
      instruments: [instrument('c', 'Concert (Ut / C)')],
      current: 'c',
      onPick,
    });
    // L'information « cette partition est en Ut » vaut d'être lue même
    // lorsqu'il n'y a rien à choisir : c'est elle qui remplace la mention
    // retirée du sous-titre.
    expect(chip.root.textContent).toContain('Ut');
    expect(chip.root.disabled).toBe(true);
    // Pas de chevron : il annoncerait un choix qui n'existe pas.
    expect(chip.root.textContent).not.toContain('▾');

    chip.root.click();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('se laisse repeindre par la vue sans rappeler `onPick`', () => {
    const onPick = vi.fn();
    const chip = createInstrumentChip({
      instruments: [instrument('c', 'Concert'), instrument('bb', 'Si bémol')],
      current: 'c',
      onPick,
    });
    chip.set('bb');
    expect(chip.root.textContent).toContain('Si♭');
    expect(onPick).not.toHaveBeenCalled();
    // Le cycle repart de la valeur imposée, pas de celle d'origine.
    chip.root.click();
    expect(onPick).toHaveBeenLastCalledWith('c');
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
