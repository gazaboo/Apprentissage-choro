/** Primitives de contrôle partagées (`dom.ts`).
 *
 * La pastille de transposition et le groupe segmenté vivaient dans
 * `transport.ts` et `trainer.ts`, chacun en double exemplaire. Les tests de
 * cycle de tonalité qui couvraient le transport ont suivi la pastille ici
 * (#137).
 */

import { describe, expect, it, vi } from 'vitest';

import { createInstrumentChip, createSegmented } from './dom';
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
