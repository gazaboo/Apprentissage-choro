import { describe, expect, it } from 'vitest';

import {
  buildSlots,
  fitDiagonalRoot,
  fitInlineRoot,
  normalizeSequence,
  simplifyChord,
  splitChordSymbol,
} from './grille';
import type { Grille } from './types';

/* Les trois corps d'écriture d'un chiffrage. `simplifyChord` ne laissant que
 * cinq formes, ce sont elles qu'il faut couvrir — plus le repli défensif. */
describe('splitChordSymbol', () => {
  it('écrit un accord majeur sans qualité ni exposant', () => {
    expect(splitChordSymbol('C')).toEqual({ root: 'C', quality: '', sup: '' });
  });

  it('pose le `m` du mineur sur la ligne', () => {
    expect(splitChordSymbol('Dm')).toEqual({ root: 'D', quality: 'm', sup: '' });
  });

  it('monte le chiffre de septième en exposant', () => {
    expect(splitChordSymbol('E7')).toEqual({ root: 'E', quality: '', sup: '7' });
  });

  it('coupe `m7b5` entre la qualité et son chiffrage', () => {
    expect(splitChordSymbol('Em7b5')).toEqual({ root: 'E', quality: 'm', sup: '7b5' });
  });

  it('garde `dim` entier sur la ligne', () => {
    expect(splitChordSymbol('Fdim')).toEqual({ root: 'F', quality: 'dim', sup: '' });
  });

  it('rend les altérations en signes typographiques', () => {
    expect(splitChordSymbol('Bb7')).toEqual({ root: 'B♭', quality: '', sup: '7' });
    expect(splitChordSymbol('F#dim')).toEqual({ root: 'F♯', quality: 'dim', sup: '' });
  });

  it('laisse un chiffrage non reconnu entier, sans mise en forme', () => {
    // Même prudence que `simplifyChord` : mieux vaut un symbole brut qu'un faux.
    expect(splitChordSymbol('N.C.')).toEqual({ root: 'N.C.', quality: '', sup: '' });
  });
});

/* Filet de sécurité sur la simplification, dont dépend tout le reste. */
describe('simplifyChord', () => {
  it('retire la basse d’un renversement', () => {
    expect(simplifyChord('A7/C#')).toBe('A7');
    expect(simplifyChord('Gm/Bb')).toBe('Gm');
  });

  it('replie les enrichissements sur leur famille', () => {
    expect(simplifyChord('Gm6')).toBe('Gm');
    expect(simplifyChord('D6')).toBe('D');
    expect(simplifyChord('F7#5')).toBe('F7');
    expect(simplifyChord('C9')).toBe('C7');
    expect(simplifyChord('Cmaj7')).toBe('C');
  });

  it('préserve les quintes diminuées', () => {
    expect(simplifyChord('C dim')).toBe('Cdim');
    expect(simplifyChord('Bø')).toBe('Bm7b5');
    expect(simplifyChord('Bmin7b5')).toBe('Bm7b5');
  });
});

/* Le signe « % » : c'est lui qui décide quelles cellules sont masquables. */
describe('normalizeSequence', () => {
  it('vide une mesure répétée à l’identique', () => {
    expect(normalizeSequence([['Dm'], ['Dm'], ['A7']])).toEqual([['Dm'], [], ['A7']]);
  });

  it('laisse vide une mesure déjà tenue, et ne la prend pas pour la précédente', () => {
    // Après un « % », la mesure de référence reste `Dm` : un `Dm` réécrit
    // ensuite doit encore devenir « % ».
    expect(normalizeSequence([['Dm'], [], ['Dm']])).toEqual([['Dm'], [], []]);
  });

  it('ne confond pas deux mesures partagées différentes', () => {
    expect(normalizeSequence([['Dm', 'A7'], ['Dm', 'G7']])).toEqual([
      ['Dm', 'A7'],
      ['Dm', 'G7'],
    ]);
  });
});

/* Les ordinaux de masquage : ils doivent suivre les cellules réellement
 * écrites, « % » sauté, et marquer les débuts de ligne de huit mesures. */
describe('buildSlots', () => {
  const grille = (sequence: string[][]): Grille => ({
    song_id: 'x',
    title: 'x',
    composer: 'x',
    parts: [{ name: 'A', sequence }],
  });

  it('numérote sans trou, en sautant les mesures tenues', () => {
    const slots = buildSlots(grille([['Dm'], ['Dm'], ['A7'], []]));
    expect(slots.map((slot) => slot.ordinal)).toEqual([0, 1]);
  });

  it('marque les débuts de ligne toutes les huit mesures écrites', () => {
    const seq = ['Dm', 'A7', 'Dm', 'A7', 'D7', 'Gm', 'E7', 'A7', 'Dm'].map((c) => [c]);
    const slots = buildSlots(grille(seq));
    expect(slots.map((slot) => slot.isLineStart)).toEqual([
      true, false, false, false, false, false, false, false, true,
    ]);
  });

  it('ne compte comme début de partie que la première mesure écrite', () => {
    const slots = buildSlots(grille([['Dm'], ['A7']]));
    expect(slots.map((slot) => slot.isPartStart)).toEqual([true, false]);
  });
});

/* Ajustement du corps dans une mesure partagée. Les largeurs ci-dessous sont
 * celles que `measureChords` relève sur la fonte du navigateur, en multiples du
 * corps de la fondamentale — elles servent ici de repères réalistes. */
const LARGEUR = { F: 0.539, D7: 0.951, Dm: 1.17, Bm7b5: 1.813, Cdiese_m7b5: 2.26 };

describe('fitDiagonalRoot', () => {
  it('écrit une mesure courte bien plus gros qu’une mesure chargée', () => {
    const court = fitDiagonalRoot([LARGEUR.Dm, LARGEUR.D7]);
    const charge = fitDiagonalRoot([LARGEUR.Cdiese_m7b5, LARGEUR.D7]);
    expect(court).toBeGreaterThan(charge * 1.25);
  });

  it('se règle sur le plus large des deux chiffrages', () => {
    // Le triangle du haut et celui du bas sont symétriques : c'est le plus
    // encombrant qui décide, quel que soit son côté.
    expect(fitDiagonalRoot([LARGEUR.F, LARGEUR.Bm7b5])).toBe(
      fitDiagonalRoot([LARGEUR.Bm7b5, LARGEUR.F]),
    );
  });

  it('décroît quand le chiffrage s’allonge', () => {
    const corps = [LARGEUR.F, LARGEUR.D7, LARGEUR.Dm, LARGEUR.Bm7b5, LARGEUR.Cdiese_m7b5]
      .map((w) => fitDiagonalRoot([w]));
    for (let i = 1; i < corps.length; i += 1) {
      expect(corps[i]!).toBeLessThanOrEqual(corps[i - 1]!);
    }
  });

  it('reste en deçà du corps d’un accord seul', () => {
    // Une mesure partagée ne doit jamais paraître plus grosse qu'une mesure
    // entière : c'est ce qui donne à lire la différence entre les deux.
    expect(fitDiagonalRoot([LARGEUR.F, LARGEUR.F])).toBeLessThan(2.8);
  });

  it('procède par paliers, pour que deux mesures voisines s’accordent', () => {
    for (const w of [0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
      expect(Math.round(fitDiagonalRoot([w]) * 20) % 1).toBe(0);
    }
  });

  it('retombe sur un corps sûr quand la mesure a échoué', () => {
    // `measureChords` rend 0 si la fonte n'a pas pu être mesurée : mieux vaut
    // un chiffrage modeste qu'un chiffrage calculé sur du vide.
    expect(fitDiagonalRoot([0])).toBe(1.2);
    expect(fitDiagonalRoot([Number.NaN])).toBe(1.2);
  });
});

describe('fitInlineRoot', () => {
  it('rétrécit à mesure que les accords s’ajoutent', () => {
    const trois = fitInlineRoot([LARGEUR.D7, LARGEUR.D7, LARGEUR.D7]);
    const quatre = fitInlineRoot([LARGEUR.D7, LARGEUR.D7, LARGEUR.D7, LARGEUR.D7]);
    expect(quatre).toBeLessThan(trois);
  });

  it('tient compte de la largeur réelle et non du seul nombre d’accords', () => {
    expect(fitInlineRoot([LARGEUR.F, LARGEUR.F, LARGEUR.F])).toBeGreaterThan(
      fitInlineRoot([LARGEUR.Bm7b5, LARGEUR.Bm7b5, LARGEUR.Bm7b5]),
    );
  });

  it('retombe sur un corps sûr quand la mesure a échoué', () => {
    expect(fitInlineRoot([0, 0, 0])).toBe(1.2);
  });
});
