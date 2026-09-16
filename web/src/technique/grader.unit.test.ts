import { describe, expect, it } from 'vitest';
import type { Onset } from '../pitch';
import { detailLignes, noter, resume } from './grader';

/** Attaque de test : seuls l'instant et la hauteur comptent pour la notation. */
function onset(audioTime: number, midi: number): Onset {
  return { audioTime, midi, frequency: 0, cents: 0, clarte: 1 };
}

/** Battues régulières d'une seconde, comme les relève `prise.beats`. */
function battues(count: number, from = 0): { index: number; time: number }[] {
  return Array.from({ length: count }, (_, i) => ({ index: from + i, time: from + i }));
}

describe('noter — start', () => {
  it('vaut 0 quand on entre dès la première battue', () => {
    const resultat = noter([60, 62, 64], [0, 1, 2], [onset(0, 60)]);
    expect(resultat.start).toBe(0);
    expect(resultat.detail).toHaveLength(3);
  });

  it('écarte les battues écoulées avant la première attaque', () => {
    // Trois clics passent pendant qu'on se met en place : la notation ne
    // commence qu'à la battue 2, et `start` doit le dire à l'appelant.
    const resultat = noter(
      [60, 62, 64, 65, 67],
      [0, 1, 2, 3, 4],
      [onset(2, 64), onset(3, 65), onset(4, 67)],
    );
    expect(resultat.start).toBe(2);
    expect(resultat.attendues).toBe(3);
    expect(resultat.justes).toBe(3);
  });

  it('vaut 0 sur un relevé vide, faute de mieux', () => {
    expect(noter([], [], []).start).toBe(0);
    expect(noter([60], [0], []).start).toBe(0);
  });
});

describe('noter — dansLaFenetre par note', () => {
  it('distingue la note en place de la note juste mais décalée', () => {
    // Battue d'une seconde : fenêtre de placement à ±300 ms, appariement
    // jusqu'à ±500 ms.
    const resultat = noter(
      [60, 62, 64],
      [0, 1, 2],
      [onset(0, 60), onset(1.4, 62), onset(2, 65)],
    );

    expect(resultat.detail.map((note) => note.dansLaFenetre)).toEqual([true, false, true]);
    // La deuxième est bien appariée (donc comptée juste), seulement hors tempo.
    expect(resultat.justes).toBe(2);
    expect(resultat.dansLaFenetre).toBe(2);
    expect(resultat.detail[1]?.joue).toBe(62);
    expect(resultat.detail[1]?.ecartMs).toBeCloseTo(400, 0);
  });

  it('une note jamais entendue n’est pas « dans la fenêtre »', () => {
    const resultat = noter([60, 62], [0, 1], [onset(0, 60)]);
    expect(resultat.detail[1]).toEqual({
      midi: 62,
      joue: null,
      ecartMs: null,
      dansLaFenetre: false,
    });
  });
});

describe('detailLignes', () => {
  it('ne garde que les notes à vérifier, situées par passe et par temps', () => {
    // Motif de 3 notes, 2 passes. Battues 0–5, une par seconde.
    const resultat = noter(
      [60, 62, 64, 60, 62, 64],
      [0, 1, 2, 3, 4, 5],
      [onset(0, 60), onset(1.2, 65), onset(3.4, 60), onset(4, 62), onset(5, 64)],
    );

    expect(detailLignes(resultat, battues(6), 3)).toEqual([
      'Passe 1, temps 2 — attendu D4, entendu F4 (écart +200 ms)',
      'Passe 1, temps 3 — attendu E4, rien entendu',
      'Passe 2, temps 1 — C4 juste, mais décalé de 400 ms',
    ]);
  });

  it('signe l’écart d’une attaque en avance', () => {
    const resultat = noter([60, 62], [0, 1], [onset(0, 60), onset(0.7, 65)]);
    expect(detailLignes(resultat, battues(2), 2)).toEqual([
      'Passe 1, temps 2 — attendu D4, entendu F4 (écart −300 ms)',
    ]);
  });

  it('ne rend aucune ligne quand tout est juste et en place', () => {
    const resultat = noter([60, 62, 64], [0, 1, 2], [onset(0, 60), onset(1, 62), onset(2, 64)]);
    expect(detailLignes(resultat, battues(3), 3)).toEqual([]);
  });

  it('numérote les passes depuis l’index de battue, pas depuis le détail', () => {
    // On entre en cours de deuxième passe : la ligne doit annoncer « Passe 2 ».
    const resultat = noter(
      [60, 62, 64, 60, 62, 64],
      [0, 1, 2, 3, 4, 5],
      [onset(4, 65)],
    );
    expect(resultat.start).toBe(4);
    expect(detailLignes(resultat, battues(6), 3)).toContain(
      'Passe 2, temps 2 — attendu D4, entendu F4 (écart +0 ms)',
    );
  });

  it('reste muet sur un motif de longueur nulle', () => {
    const resultat = noter([60], [0], [onset(0, 65)]);
    expect(detailLignes(resultat, battues(1), 0)).toEqual([]);
  });
});

describe('resume', () => {
  it('dit que le micro n’a rien entendu quand rien n’a été apparié', () => {
    expect(resume(noter([], [], []), 72)).toContain('n’a rien entendu');
  });

  it('sépare les notes justes du placement, sans verdict', () => {
    const resultat = noter([60, 62], [0, 1], [onset(0, 60), onset(1, 65)]);
    const texte = resume(resultat, 72);
    expect(texte).toContain('72 BPM');
    expect(texte).toContain('1 note juste sur 2');
    expect(texte).toContain('à vous de juger');
  });
});
