import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Progress } from '../store';
import type { SrsCard } from '../types';
import {
  DEFAULT_ROOTS,
  estAccordNaturel,
  expandMotif,
  parAccord,
  parMotif,
  pickExercices,
  presetsTechnique,
  type ExerciceCarte,
  type Sens,
} from './catalogue';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Régression du bug corrigé en PR #38 (cf. mémoire "arpèges aller-retour :
// descente") : la montée place sa fondamentale via `layoutMotif` (registre
// dynamique), la descente garde l'octave écrite dans le catalogue transposée
// telle quelle — les deux ne coïncident que par coïncidence dans la tonalité
// de référence. `expandMotif` doit recaler la descente pour que le
// aller-retour revienne exactement sur sa note de départ, **dans toutes les
// tonalités transposées**, pas seulement celle où le motif a été écrit.
describe('expandMotif — jonction montée/descente (aller-retour)', () => {
  const SENS_ALLER_RETOUR: Sens[] = ['aller-retour'];

  // Motif synthétique à la forme du catalogue réel (sommet à l'octave
  // supérieure, descente jusqu'à la fondamentale, octaves explicites) :
  // vérifie le mécanisme de recalage indépendamment des données versionnées.
  const motifSynthetique = {
    id: 'test-arp',
    famille: 'Test',
    nom: 'Arpège test',
    reference: 'Dm',
    notes: ['D', 'E', 'F', 'A'],
    notes_descendant: ['D4', 'C4', 'A3', 'F3', 'D3'],
    roots: DEFAULT_ROOTS,
    sens: SENS_ALLER_RETOUR,
  };

  for (const root of DEFAULT_ROOTS) {
    it(`motif synthétique : aucun saut d'octave à la jonction en ${root}`, () => {
      const carte = expandMotif(motifSynthetique).find(
        (c) => c.id === `test-arp::${root}::aller-retour`,
      );
      expect(carte).toBeDefined();
      // Le aller-retour part de la fondamentale de la montée et doit y
      // revenir exactement : `midi[0]` et le dernier élément sont la même
      // hauteur, quelle que soit la tonalité transposée.
      expect(carte!.midi.at(-1)).toBe(carte!.midi[0]);
    });
  }

  const catalogue: { exercices: unknown[] } = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../public/data/technique/exercices.json'),
      'utf8',
    ),
  );
  const motifsAvecDescente = catalogue.exercices.filter(
    (m): m is { id: string; roots?: string[] } & Record<string, unknown> =>
      typeof m === 'object' && m !== null && 'notes_descendant' in m,
  );

  it('le catalogue versionné contient au moins un motif aller-retour à vérifier', () => {
    expect(motifsAvecDescente.length).toBeGreaterThan(0);
  });

  for (const motif of motifsAvecDescente) {
    const roots = Array.isArray(motif.roots) ? motif.roots : DEFAULT_ROOTS;
    for (const root of roots) {
      it(`${motif.id} : aucun saut d'octave à la jonction en ${root}`, () => {
        const carte = expandMotif(
          motif as unknown as Parameters<typeof expandMotif>[0],
        ).find(
          (c) => c.id === `${motif.id}::${root}::aller-retour`,
        );
        expect(carte).toBeDefined();
        expect(carte!.midi.at(-1)).toBe(carte!.midi[0]);
      });
    }
  }
});

function carte(id: string): ExerciceCarte {
  return {
    id,
    motifId: id,
    famille: 'test',
    nom: id,
    accord: id,
    sens: 'montant',
    notes: [],
    midi: [],
    noteDeTravail: null,
  };
}

function baseProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
    techniqueSetlists: [],
    activeTechniqueSetlistId: null,
    techniquePresetsSeeded: false,
    sessions: [],
    _rev: 0,
    settings: {
      blockMinutes: 5,
      display: 'partition',
      studyMode: 'mesures',
      maskLevel: 50,
      maskSeed: 1,
      eclipseIntensity: 'moyennes',
      instrumentDefault: 'c',
      contrechant: 'sans',
      panel: null,
      fullpage: { zoom: 1, twoColumns: true, playerHidden: false },
    },
    ...overrides,
  } as Progress;
}

/** Carte SRS « en retard », déjà travaillée, échue depuis `due`. */
function carteEnRetard(due: string): SrsCard {
  return {
    ease: 2.5,
    interval: 1,
    repetitions: 1,
    due,
    history: [{ date: '2020-01-01', grade: 4, tempo: 'fluide', hints: 0 }],
  };
}

describe('pickExercices — ordre aléatoire à égalité de retard (#82)', () => {
  // Cinq cartes déjà travaillées, échues à la même date : même retard.
  const cartes = ['a', 'b', 'c', 'd', 'e'].map(carte);
  function progressAvecMemeRetard(): Progress {
    return baseProgress({
      cards: Object.fromEntries(cartes.map((c) => [`tech::${c.id}`, carteEnRetard('2000-01-01')])),
    });
  }

  it('une graine fixe donne un ordre déterministe et reproductible', () => {
    const first = pickExercices(cartes, progressAvecMemeRetard(), 0, () => 0.42).map((c) => c.id);
    const second = pickExercices(cartes, progressAvecMemeRetard(), 0, () => 0.42).map(
      (c) => c.id,
    );
    expect(first).toEqual(second);
  });

  it('deux séquences de rng différentes donnent des ordres différents', () => {
    let callA = 0;
    const sequence = [0.1, 0.9, 0.2, 0.8, 0.3];
    const rngA = () => sequence[callA++ % sequence.length]!;
    let callB = 0;
    const reversed = [...sequence].reverse();
    const rngB = () => reversed[callB++ % reversed.length]!;

    const orderA = pickExercices(cartes, progressAvecMemeRetard(), 0, rngA).map((c) => c.id);
    const orderB = pickExercices(cartes, progressAvecMemeRetard(), 0, rngB).map((c) => c.id);
    expect(orderA).not.toEqual(orderB);
    // Même ensemble malgré l'ordre différent : rien n'est perdu ni dupliqué.
    expect([...orderA].sort()).toEqual([...orderB].sort());
  });

  it('sans rng fourni (`Math.random` par défaut), reste une permutation valide', () => {
    for (let i = 0; i < 5; i += 1) {
      const order = pickExercices(cartes, progressAvecMemeRetard(), 0).map((c) => c.id);
      expect([...order].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });

  it('ne mélange jamais deux cartes de retard différent', () => {
    // "a", "b" très en retard (échues en 2000) ; "c", "d", "e" un peu en
    // retard (échues en 2010) : les deux premières doivent toujours devancer
    // les trois autres, quel que soit le tirage à l'intérieur de chaque
    // groupe.
    const progress = baseProgress({
      cards: {
        'tech::a': carteEnRetard('2000-01-01'),
        'tech::b': carteEnRetard('2000-01-01'),
        'tech::c': carteEnRetard('2010-01-01'),
        'tech::d': carteEnRetard('2010-01-01'),
        'tech::e': carteEnRetard('2010-01-01'),
      },
    });
    for (const value of [0.01, 0.5, 0.99]) {
      const order = pickExercices(cartes, progress, 0, () => value).map((c) => c.id);
      expect(new Set(order.slice(0, 2))).toEqual(new Set(['a', 'b']));
      expect(new Set(order.slice(2))).toEqual(new Set(['c', 'd', 'e']));
    }
  });

  it('les cartes neuves restent dans l’ordre du catalogue, non mélangées', () => {
    const progress = baseProgress({
      cards: { 'tech::b': carteEnRetard('2000-01-01') },
    });
    const trois = ['a', 'b', 'c'].map(carte);
    // "a" et "c" sont neuves (jamais travaillées) : elles suivent "b" (en
    // retard) dans l'ordre du catalogue, jamais mélangées entre elles.
    for (const value of [0.01, 0.5, 0.99]) {
      const order = pickExercices(trois, progress, 5, () => value).map((c) => c.id);
      expect(order).toEqual(['b', 'a', 'c']);
    }
  });
});

/** Carte de fixture pour les tests de regroupement, motif/accord/sens réglables. */
function carteGroupee(overrides: Partial<ExerciceCarte>): ExerciceCarte {
  return {
    id: `${overrides.motifId}::${overrides.accord}::${overrides.sens}`,
    motifId: 'motif',
    famille: 'famille',
    nom: 'nom',
    accord: 'C',
    sens: 'montant',
    notes: [],
    midi: [],
    noteDeTravail: null,
    ...overrides,
  };
}

// Ces deux groupements alimentent la vue d'ensemble (`technique-liste.ts`) et
// l'éditeur de setlist de technique (#127) — une pastille par tonalité doit
// réunir montant et descendant, et rester distincte d'une autre tonalité.
describe('parMotif / parAccord — regroupement pour l’affichage en pastilles', () => {
  it('parMotif sépare les cartes par motif, dans l’ordre d’apparition', () => {
    const cartes = [
      carteGroupee({ motifId: 'arp-m', accord: 'C', sens: 'montant' }),
      carteGroupee({ motifId: 'gamme', accord: 'C', sens: 'montant' }),
      carteGroupee({ motifId: 'arp-m', accord: 'D', sens: 'montant' }),
    ];
    const groups = parMotif(cartes);
    expect([...groups.keys()]).toEqual(['arp-m', 'gamme']);
    expect(groups.get('arp-m')).toHaveLength(2);
    expect(groups.get('gamme')).toHaveLength(1);
  });

  it('parAccord réunit montant et descendant d’une même tonalité dans un seul groupe', () => {
    const cartes = [
      carteGroupee({ motifId: 'arp-m', accord: 'C', sens: 'montant' }),
      carteGroupee({ motifId: 'arp-m', accord: 'C', sens: 'descendant' }),
      carteGroupee({ motifId: 'arp-m', accord: 'D', sens: 'montant' }),
    ];
    const groups = parAccord(cartes);
    expect([...groups.keys()]).toEqual(['C', 'D']);
    expect(groups.get('C')).toHaveLength(2);
    expect(groups.get('D')).toHaveLength(1);
  });
});

describe('estAccordNaturel', () => {
  it.each([
    ['C', true],
    ['Dm7', true],
    ['Bdim7', true],
    ['C#', false],
    ['C#m7', false],
    ['Eb', false],
    ['Bm7b5', true],
    ['F#dim7', false],
  ])('%s → %s', (accord, attendu) => {
    expect(estAccordNaturel(accord)).toBe(attendu);
  });
});

// Setlists de technique suggérées par défaut (#158) : elles alimentent le
// seeding fait une seule fois au démarrage (`main.ts` boot). Vérifie le
// filtrage plutôt que la seule tonalité de référence — voir CLAUDE.md.
describe('presetsTechnique', () => {
  it('regroupe les arpèges et les gammes courantes, tonalités sans dièse ni bémol seulement', () => {
    const cartes = [
      carteGroupee({ id: 'arp-c', motifId: 'arp-maj', famille: 'Arpèges', accord: 'C' }),
      carteGroupee({ id: 'arp-cs', motifId: 'arp-maj', famille: 'Arpèges', accord: 'C#' }),
      carteGroupee({ id: 'gamme-maj-d', motifId: 'gamme-majeure', famille: 'Gammes', accord: 'D' }),
      carteGroupee({
        id: 'gamme-harm-d',
        motifId: 'gamme-mineure-harmonique',
        famille: 'Gammes',
        accord: 'D',
      }),
      carteGroupee({ id: 'gamme-min-eb', motifId: 'gamme-mineure', famille: 'Gammes', accord: 'Eb' }),
    ];

    const presets = presetsTechnique(cartes);
    const arpeges = presets.find((preset) => preset.id === 'preset-arpeges-naturels');
    const gammes = presets.find((preset) => preset.id === 'preset-gammes-naturelles');

    expect(arpeges?.exerciceIds).toEqual(['arp-c']);
    expect(gammes?.exerciceIds).toEqual(['gamme-maj-d']);
  });

  it('omet une setlist sans aucune carte correspondante plutôt que de la proposer vide', () => {
    const cartes = [carteGroupee({ id: 'x', motifId: 'gamme-mineure-melodique', famille: 'Gammes' })];
    expect(presetsTechnique(cartes)).toEqual([]);
  });
});
