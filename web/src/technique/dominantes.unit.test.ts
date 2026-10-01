import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  accordDeLaNote,
  etiquetteTonalite,
  expandMotif,
  type ExerciceCarte,
} from './catalogue';
import { chordRoot, degre, parseNote, pitchClass } from './theorie';
import { DEBORD_LIGNE_SUPPLEMENTAIRE, TETE_DEMI_LARGEUR, mettreEnPortee } from './portee';

// Famille « Dominantes » : des phrases qui passent d'un accord à un autre
// (« G7 → C »). Tout y dépend de la transposition de *chaque* accord et du
// recalage de registre — on vérifie donc toutes les tonalités, pas seulement
// celle d'écriture (cf. les bugs d'octave des arpèges, PR #37/#38).

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogue: { exercices: Parameters<typeof expandMotif>[0][] } = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/technique/exercices.json'), 'utf8'),
);
const cartes = catalogue.exercices.flatMap(expandMotif);
const dominantes = cartes.filter((carte) => carte.famille === 'Dominantes');
const phrases = dominantes.filter((carte) => carte.segments !== null);

function carte(id: string): ExerciceCarte {
  const found = cartes.find((c) => c.id === id);
  if (!found) throw new Error(`Carte absente : ${id}`);
  return found;
}

/** Degré d'une note de la carte par rapport à l'accord qui sonne sous elle. */
function degreDansAccord(c: ExerciceCarte, index: number): string {
  const note = parseNote(c.notes[index]!);
  const root = chordRoot(accordDeLaNote(c, index));
  if (!note || !root) throw new Error(`Note ou accord illisible dans ${c.id}`);
  return degre(note, root);
}

/** Note d'arrivée attendue sur l'accord cible, par motif. */
const ARRIVEE: Record<string, string> = {
  'dom-basse-maj': '3',
  'dom-dino-maj': '3',
  'dom-mixo-maj': '3',
  'dom-basse-min': '♭3',
  'dom-dino-min': '♭3',
  'dom-mixo-min': '♭3',
  'dom-b9-min': '5',
  'dom-251-maj': '3',
  'dom-251-min': '♭3',
  'dom-cycle': '3',
};

describe('Dominantes — dépliage du catalogue', () => {
  it('engendre chaque phrase dans les 12 tonalités', () => {
    for (const motifId of Object.keys(ARRIVEE)) {
      expect(phrases.filter((c) => c.motifId === motifId)).toHaveLength(12);
    }
  });

  it('transpose tous les accords de la phrase, pas seulement le premier', () => {
    expect(carte('dom-dino-maj::C::phrase').accord).toBe('G7 → C');
    expect(carte('dom-dino-maj::Eb::phrase').accord).toBe('Bb7 → Eb');
    expect(carte('dom-dino-maj::F#::phrase').accord).toBe('C#7 → F#');
    expect(carte('dom-dino-min::G#::phrase').accord).toBe('D#7 → G#m');
    expect(carte('dom-251-min::Bb::phrase').accord).toBe('Cm7b5 → F7 → Bbm');
    expect(carte('dom-cycle::Ab::phrase').accord).toBe('Bb7 → Eb7 → Ab');
  });

  it('titre une phrase qui alterne deux accords par ses accords distincts', () => {
    const basse = carte('dom-basse-maj::D::phrase');
    expect(basse.accord).toBe('A7 → D');
    expect(basse.segments).toHaveLength(8);
  });

  it('étiquette une puce par l’accord d’arrivée', () => {
    expect(etiquetteTonalite(carte('dom-mixo-min::Eb::phrase'))).toBe('Ebm');
    expect(etiquetteTonalite(carte('dom-gamme-mixo::G::montant'))).toBe('G7');
  });

  it('garde l’orthographe : ♭9 et ♭13 de C7 en fa mineur sont Db et Ab', () => {
    const c = carte('dom-mixo-min::F::phrase');
    expect(c.accord).toBe('C7(b9 b13) → Fm');
    expect(c.notes).toEqual(['C', 'Db', 'E', 'F', 'G', 'Ab', 'Bb', 'Ab']);
  });

  it('fait correspondre noms et hauteurs dans toutes les tonalités', () => {
    for (const c of dominantes) {
      c.notes.forEach((nom, i) => {
        const note = parseNote(nom);
        expect(note, `${c.id} : ${nom}`).not.toBeNull();
        expect(((c.midi[i]! % 12) + 12) % 12, `${c.id} : ${nom}`).toBe(pitchClass(note!));
      });
    }
  });
});

describe('Dominantes — la musique', () => {
  it('arrive sur la bonne note de l’accord cible, dans chaque tonalité', () => {
    for (const c of phrases) {
      const attendu = ARRIVEE[c.motifId];
      expect(attendu, c.motifId).toBeDefined();
      expect(degreDansAccord(c, c.notes.length - 1), c.id).toBe(attendu);
    }
  });

  it('la 7e de chaque accord descend sur la tierce du suivant (ii–V–I, cycle)', () => {
    const chaines = phrases.filter((c) =>
      ['dom-251-maj', 'dom-251-min', 'dom-cycle'].includes(c.motifId),
    );
    expect(chaines).toHaveLength(36);
    for (const c of chaines) {
      for (const segment of c.segments!.slice(1)) {
        const avant = segment.debut - 1;
        expect(degreDansAccord(c, avant), c.id).toBe('♭7');
        expect(degreDansAccord(c, segment.debut), c.id).toMatch(/^♭?3$/);
        const pas = c.midi[avant]! - c.midi[segment.debut]!;
        expect(pas === 1 || pas === 2, `${c.id} : ${pas} demi-tons`).toBe(true);
      }
    }
  });

  it('mesure les degrés depuis l’accord qui sonne : le do de G7 → C est une fondamentale', () => {
    const c = carte('dom-basse-maj::C::phrase');
    expect(c.notes.map((_, i) => degreDansAccord(c, i))).toEqual([
      '1', '1', '3', '1', '5', '1', '♭7', '3',
    ]);
  });
});

describe('Dominantes — registre', () => {
  it('place chaque phrase au même registre, à partir du fa dièse grave, sur une octave environ', () => {
    for (const c of phrases) {
      const grave = Math.min(...c.midi);
      expect(grave, c.id).toBeGreaterThanOrEqual(42);
      expect(grave, c.id).toBeLessThan(54);
      // Une octave, plus le demi-ton de la ♭9 au-dessus de la fondamentale.
      expect(Math.max(...c.midi) - grave, c.id).toBeLessThanOrEqual(13);
    }
  });

  it('ne saute jamais de plus d’une octave entre deux notes', () => {
    for (const c of dominantes) {
      for (let i = 1; i < c.midi.length; i += 1) {
        expect(Math.abs(c.midi[i]! - c.midi[i - 1]!), c.id).toBeLessThanOrEqual(12);
      }
    }
  });

  it('ignore une phrase dont une note n’a pas d’octave', () => {
    expect(
      expandMotif({
        id: 'test',
        famille: 'Dominantes',
        nom: 'test',
        reference: 'C',
        notes: [],
        segments: [
          { accord: 'G7', notes: ['G2', 'F'] },
          { accord: 'C', notes: ['E3'] },
        ],
      }),
    ).toEqual([]);
  });
});

describe('Dominantes — barres d’accord sur la portée', () => {
  it('glisse chaque barre entre deux notes sans toucher lignes ni altérations', () => {
    for (const c of phrases) {
      const debuts = c.segments!.map((segment) => segment.debut);
      const mise = mettreEnPortee(c.notes, c.midi, null, debuts);
      expect(mise.barres, c.id).toHaveLength(debuts.length - 1);
      mise.barres.forEach((x, i) => {
        const suivante = mise.notes[debuts[i + 1]!]!;
        const precedente = mise.notes[debuts[i + 1]! - 1]!;
        expect(x, c.id).toBeGreaterThan(
          precedente.x + TETE_DEMI_LARGEUR + DEBORD_LIGNE_SUPPLEMENTAIRE,
        );
        expect(x, c.id).toBeLessThan(suivante.xAlteration ?? suivante.x - TETE_DEMI_LARGEUR);
      });
    }
  });
});
