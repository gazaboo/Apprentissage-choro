import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOTS, expandMotif, type Sens } from './catalogue';

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
