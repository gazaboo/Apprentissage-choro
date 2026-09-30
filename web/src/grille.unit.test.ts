import { describe, expect, it } from 'vitest';

import {
  buildSlots,
  emptyHalfRowIndices,
  fitInlineRoot,
  normalizeSequence,
  simplifyChord,
  splitChordSymbol,
} from './grille';
import { GRILLE_ZOOM_LEVELS, nearestGrilleZoom, stepGrilleZoom } from './grilleZoom';
import type { Grille } from './types';

/* Les trois corps d'écriture d'un chiffrage. `simplifyChord` ne laissant que
 * cinq formes, ce sont elles qu'il faut couvrir — plus le repli défensif. */
describe('splitChordSymbol', () => {
  it('écrit un accord majeur sans qualité ni exposant', () => {
    expect(splitChordSymbol('C')).toEqual({ root: 'C', accidental: '', quality: '', sup: '' });
  });

  it('pose le `m` du mineur sur la ligne', () => {
    expect(splitChordSymbol('Dm')).toEqual({ root: 'D', accidental: '', quality: 'm', sup: '' });
  });

  it('monte le chiffre de septième en exposant', () => {
    expect(splitChordSymbol('E7')).toEqual({ root: 'E', accidental: '', quality: '', sup: '7' });
  });

  it('coupe `m7b5` entre la qualité et son chiffrage', () => {
    expect(splitChordSymbol('Em7b5')).toEqual({ root: 'E', accidental: '', quality: 'm', sup: '7b5' });
  });

  it('garde `dim` entier sur la ligne', () => {
    expect(splitChordSymbol('Fdim')).toEqual({ root: 'F', accidental: '', quality: 'dim', sup: '' });
  });

  it('rend les altérations en signes typographiques, à part de la lettre', () => {
    expect(splitChordSymbol('Bb7')).toEqual({ root: 'B', accidental: '♭', quality: '', sup: '7' });
    expect(splitChordSymbol('F#dim')).toEqual({ root: 'F', accidental: '♯', quality: 'dim', sup: '' });
  });

  it('laisse un chiffrage non reconnu entier, sans mise en forme', () => {
    // Même prudence que `simplifyChord` : mieux vaut un symbole brut qu'un faux.
    expect(splitChordSymbol('N.C.')).toEqual({ root: 'N.C.', accidental: '', quality: '', sup: '' });
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

describe('fitInlineRoot', () => {
  it('donne la même part à chaque accord d’une mesure, réglée sur le plus large', () => {
    // Parts égales : la place d'un accord dit sur quel temps il tombe. L'ordre
    // n'y change donc rien, et c'est le plus encombrant qui décide.
    expect(fitInlineRoot([LARGEUR.F, LARGEUR.Bm7b5])).toBe(
      fitInlineRoot([LARGEUR.Bm7b5, LARGEUR.F]),
    );
    expect(fitInlineRoot([LARGEUR.F, LARGEUR.Bm7b5])).toBe(
      fitInlineRoot([LARGEUR.Bm7b5, LARGEUR.Bm7b5]),
    );
  });

  it('écrit une mesure courte bien plus gros qu’une mesure chargée', () => {
    const court = fitInlineRoot([LARGEUR.Dm, LARGEUR.D7]);
    const charge = fitInlineRoot([LARGEUR.Cdiese_m7b5, LARGEUR.D7]);
    expect(court).toBeGreaterThan(charge * 1.25);
  });

  it('rétrécit à mesure que les accords s’ajoutent', () => {
    const un = fitInlineRoot([LARGEUR.D7]);
    const deux = fitInlineRoot([LARGEUR.D7, LARGEUR.D7]);
    const trois = fitInlineRoot([LARGEUR.D7, LARGEUR.D7, LARGEUR.D7]);
    expect(deux).toBeLessThan(un);
    expect(trois).toBeLessThan(deux);
  });

  it('décroît quand le chiffrage s’allonge', () => {
    const corps = [LARGEUR.F, LARGEUR.D7, LARGEUR.Dm, LARGEUR.Bm7b5, LARGEUR.Cdiese_m7b5]
      .map((w) => fitInlineRoot([w, w]));
    for (let i = 1; i < corps.length; i += 1) {
      expect(corps[i]!).toBeLessThanOrEqual(corps[i - 1]!);
    }
  });

  it('laisse la place d’une barre de reprise ou d’un numéro de fin', () => {
    const libre = fitInlineRoot([LARGEUR.Dm, LARGEUR.D7]);
    expect(fitInlineRoot([LARGEUR.Dm, LARGEUR.D7], 1.1)).toBeLessThan(libre);
    // Une 1re fin qui ferme aussi la reprise perd des deux côtés.
    expect(fitInlineRoot([LARGEUR.Dm, LARGEUR.D7], 1.1, 1.1)).toBeLessThan(
      fitInlineRoot([LARGEUR.Dm, LARGEUR.D7], 1.1),
    );
  });

  it('tient deux accords courants au-delà de 1,5 em de fondamentale', () => {
    // Repère des maquettes : côte à côte, `Dm | D7` doit rester nettement plus
    // gros que dans l'ancienne diagonale (~1,3 em sur téléphone).
    expect(fitInlineRoot([LARGEUR.Dm, LARGEUR.D7])).toBeGreaterThanOrEqual(1.5);
  });

  it('procède par paliers, pour que deux mesures voisines s’accordent', () => {
    for (const w of [0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
      expect(Math.round(fitInlineRoot([w, w]) * 20) % 1).toBe(0);
    }
  });

  it('retombe sur un corps sûr quand la mesure a échoué', () => {
    // `measureChords` rend 0 si la fonte n'a pas pu être mesurée : mieux vaut
    // un chiffrage modeste qu'un chiffrage calculé sur du vide.
    expect(fitInlineRoot([0])).toBe(1.2);
    expect(fitInlineRoot([Number.NaN])).toBe(1.2);
    expect(fitInlineRoot([0, 0, 0])).toBe(1.2);
    expect(fitInlineRoot([])).toBe(1.2);
  });
});

describe('paliers de taille de la grille', () => {
  it('ramène une valeur quelconque au palier le plus proche', () => {
    expect(nearestGrilleZoom(1)).toBe(1);
    expect(nearestGrilleZoom(1.3)).toBe(1.25);
    expect(nearestGrilleZoom(0.1)).toBe(GRILLE_ZOOM_LEVELS[0]);
    expect(nearestGrilleZoom(12)).toBe(GRILLE_ZOOM_LEVELS[GRILLE_ZOOM_LEVELS.length - 1]);
    expect(nearestGrilleZoom(Number.NaN)).toBe(1);
  });

  it('avance d’un palier à la fois et s’arrête aux extrémités', () => {
    expect(stepGrilleZoom(1, 1)).toBe(1.25);
    expect(stepGrilleZoom(1, -1)).toBe(0.85);
    expect(stepGrilleZoom(0.85, -1)).toBe(0.85);
    expect(stepGrilleZoom(1.9, 1)).toBe(1.9);
  });
});

/* Repli en quatre colonnes : une demi-rangée de bourrage y ferait une rangée
 * blanche entière, un saut de ligne entre les fins de partie (#152). */
describe('emptyHalfRowIndices', () => {
  const row = (spec: string): boolean[] => [...spec].map((c) => c === '.');

  it('repère la demi-rangée vide qui suit une 1re fin de deux mesures', () => {
    // 1re fin : deux mesures, deux cases de bourrage pour finir la moitié,
    // puis la seconde moitié entièrement vide.
    expect(emptyHalfRowIndices(row('xx......'))).toEqual([4, 5, 6, 7]);
  });

  it('repère la moitié gauche vide quand la 2e fin est alignée à droite', () => {
    expect(emptyHalfRowIndices(row('......xx'))).toEqual([0, 1, 2, 3]);
  });

  it('laisse une demi-rangée qui porte au moins une mesure', () => {
    expect(emptyHalfRowIndices(row('xxx..x..'))).toEqual([]);
    expect(emptyHalfRowIndices(row('xxxxxxxx'))).toEqual([]);
  });

  it('traite chaque rangée indépendamment', () => {
    expect(emptyHalfRowIndices(row('xxxxxxxx' + 'xx......' + 'xx......'))).toEqual([
      12, 13, 14, 15, 20, 21, 22, 23,
    ]);
  });
});
