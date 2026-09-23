import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandMotif, type ExerciceCarte } from './catalogue';
import {
  CLE_LARGEUR,
  CLE_X,
  DEBORD_LIGNE_SUPPLEMENTAIRE,
  HAMPE,
  HAUTEUR_ALTERATION,
  INTERLIGNE,
  LARGEUR_ALTERATION,
  LARGEUR_REFERENCE,
  PAS,
  SEPARATION,
  TETE_DEMI_LARGEUR,
  echelonEcrit,
  mettreEnPortee,
  sommet,
} from './portee';
import { degre, parseNote } from './theorie';

const __dirname = dirname(fileURLToPath(import.meta.url));

function catalogue(): ExerciceCarte[] {
  const data = JSON.parse(
    readFileSync(resolve(__dirname, '../../public/data/technique/exercices.json'), 'utf8'),
  ) as { exercices: Parameters<typeof expandMotif>[0][] };
  return data.exercices.flatMap((motif) => expandMotif(motif));
}

const mise = (carte: ExerciceCarte) =>
  mettreEnPortee(carte.notes, carte.midi, sommet(carte.midi, carte.sens));

describe('echelonEcrit — clé de sol octaviée', () => {
  it('écrit le mi grave de la guitare trois lignes sous la portée', () => {
    // Mi 2 sonne, mi 3 s'écrit : 7 échelons sous la ligne du bas (mi 4 écrit).
    expect(echelonEcrit('E', 40).echelon).toBe(2 + 7 * 3);
  });

  it('tire l\'octave de la lettre, pas du son (do bémol, si dièse, fa double dièse)', () => {
    // Do bémol 4 sonne comme si 3 (59) mais s'écrit sur la ligne du do.
    expect(echelonEcrit('Cb', 59)).toEqual({ echelon: 0 + 7 * 5, alter: -1 });
    // Si dièse 3 sonne comme do 4 (60) mais s'écrit sur le si.
    expect(echelonEcrit('B#', 60)).toEqual({ echelon: 6 + 7 * 4, alter: 1 });
    expect(echelonEcrit('F##', 55)).toEqual({ echelon: 3 + 7 * 4, alter: 2 });
  });
});

describe('mettreEnPortee', () => {
  it('trace les lignes supplémentaires du mi grave, et aucune au milieu', () => {
    const { notes, lignes } = mettreEnPortee(['E', 'B'], [40, 59]);
    const basse = lignes[4]!;
    expect(notes[0]!.lignesSupplementaires).toEqual([
      basse + INTERLIGNE,
      basse + 2 * INTERLIGNE,
      basse + 3 * INTERLIGNE,
    ]);
    // Le mi grave pend *sous* la troisième ligne supplémentaire.
    expect(notes[0]!.y).toBe(basse + 3.5 * INTERLIGNE);
    // Si 3 sonne, si 4 s'écrit : la ligne du milieu, sans ligne supplémentaire.
    expect(notes[1]!.y).toBe(lignes[2]);
    expect(notes[1]!.lignesSupplementaires).toEqual([]);
  });

  it('oriente la hampe vers le haut sous la ligne du milieu, vers le bas à partir d\'elle', () => {
    const { notes } = mettreEnPortee(['A', 'B', 'C'], [57, 59, 60]);
    expect(notes.map((n) => n.hampe)).toEqual(['haut', 'bas', 'bas']);
  });

  it('marque le demi-tour d\'un aller-retour entre le sommet et la note suivante', () => {
    const carte = catalogue().find((c) => c.id === 'arp-m::A::aller-retour') ??
      catalogue().find((c) => c.sens === 'aller-retour')!;
    const m = mise(carte);
    const haut = sommet(carte.midi, carte.sens)!;
    expect(m.separation).not.toBeNull();
    expect(m.separation!).toBeGreaterThan(m.notes[haut]!.x);
    expect(m.separation!).toBeLessThan(m.notes[haut + 1]!.x);
  });
});

describe('mettreEnPortee — tout le catalogue', () => {
  const cartes = catalogue();

  it('couvre bien les douze tonalités de chaque motif', () => {
    expect(cartes.length).toBeGreaterThan(100);
  });

  it('garde un pas constant entre les têtes (plus le demi-tour d\'un aller-retour)', () => {
    for (const carte of cartes) {
      const { notes } = mise(carte);
      const haut = sommet(carte.midi, carte.sens);
      for (let i = 1; i < notes.length; i += 1) {
        const attendu = PAS + (haut !== null && i === haut + 1 ? SEPARATION : 0);
        expect(notes[i]!.x - notes[i - 1]!.x, carte.id).toBeCloseTo(attendu);
      }
    }
  });

  it('ne fait jamais toucher une altération à la tête précédente ni à la clé', () => {
    for (const carte of cartes) {
      const { notes } = mise(carte);
      notes.forEach((note, i) => {
        if (note.xAlteration === null) return;
        // Ni la tête précédente ni ses lignes supplémentaires, ni la clé.
        const precedente = notes[i - 1];
        const gauche =
          precedente === undefined
            ? CLE_X + CLE_LARGEUR
            : precedente.x + TETE_DEMI_LARGEUR +
              (precedente.lignesSupplementaires.length > 0 ? DEBORD_LIGNE_SUPPLEMENTAIRE : 0);
        expect(note.xAlteration - gauche, `${carte.id} note ${i}`).toBeGreaterThanOrEqual(3);
        // Et l'altération ne mord ni sur sa tête ni sur ses propres lignes supplémentaires.
        const droite = note.xAlteration + (LARGEUR_ALTERATION[note.alter] ?? 0);
        expect(note.x - TETE_DEMI_LARGEUR - DEBORD_LIGNE_SUPPLEMENTAIRE - droite).toBeGreaterThan(0);
      });
    }
  });

  it('loge tout dans le cadre : têtes, hampes, altérations, lignes supplémentaires, texte', () => {
    for (const carte of cartes) {
      const m = mise(carte);
      expect(m.largeur, carte.id).toBeLessThanOrEqual(LARGEUR_REFERENCE + 1e-9);
      for (const note of m.notes) {
        const hampeHaut = note.hampe === 'haut' ? note.y - HAMPE : note.y;
        const hampeBas = note.hampe === 'bas' ? note.y + HAMPE : note.y;
        const acc = HAUTEUR_ALTERATION[note.alter]!;
        expect(Math.min(hampeHaut, note.y - acc.haut, note.y - 5), carte.id).toBeGreaterThanOrEqual(0);
        // Tout ce qui est dessiné reste au-dessus de la rangée des noms.
        expect(Math.max(hampeBas, note.y + acc.bas, note.y + 5), carte.id)
          .toBeLessThan(m.yNoms - 10);
        expect(note.x + TETE_DEMI_LARGEUR + 8).toBeLessThanOrEqual(m.x1);
        for (const y of note.lignesSupplementaires) {
          expect(y > m.lignes[4]! || y < m.lignes[0]!).toBe(true);
        }
      }
      expect(m.yDegres).toBeLessThanOrEqual(m.hauteur);
    }
  });

  it('dessine toutes les portées à la même hauteur, quelle que soit la tonalité', () => {
    const hauteurs = new Set(cartes.map((c) => mise(c).hauteur));
    const lignesHautes = new Set(cartes.map((c) => mise(c).lignes[0]));
    expect(hauteurs.size).toBe(1);
    expect(lignesHautes.size).toBe(1);
  });
});

describe('degre', () => {
  const d = (note: string, root: string) => degre(parseNote(note)!, parseNote(root)!);

  it('nomme les degrés par l\'orthographe, dans plusieurs tonalités', () => {
    // Arpège mineur de ré, montée puis descente choro : 1 2 ♭3 5 | ♭6.
    expect(['D', 'E', 'F', 'A', 'Bb'].map((n) => d(n, 'D'))).toEqual(['1', '2', '♭3', '5', '♭6']);
    // Même forme transposée en fa dièse.
    expect(['F#', 'G#', 'A', 'C#', 'D'].map((n) => d(n, 'F#'))).toEqual(['1', '2', '♭3', '5', '♭6']);
    // Dominante de la : 1 3 5 ♭7.
    expect(['A', 'C#', 'E', 'G'].map((n) => d(n, 'A'))).toEqual(['1', '3', '5', '♭7']);
    // Diminué de si : 1 ♭3 ♭5 ♭♭7.
    expect(['B', 'D', 'F', 'Ab'].map((n) => d(n, 'B'))).toEqual(['1', '♭3', '♭5', '♭♭7']);
    // Sensible haussée de la mineure harmonique, en mi bémol mineur.
    expect(d('D', 'Eb')).toBe('7');
    expect(d('Cb', 'Eb')).toBe('♭6');
  });
});
