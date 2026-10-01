import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { expandMotif, type ExerciceCarte } from '../technique/catalogue';
import { FICHES_CONSEILS, ficheConseils, fichesDeLaFamille } from '../technique/conseils';
import { renderTechniqueConseils } from './technique-conseils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogue: { exercices: Parameters<typeof expandMotif>[0][] } = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/technique/exercices.json'), 'utf8'),
);
const cartes = catalogue.exercices.flatMap(expandMotif);

function mount(id = 'dominante-vers-mineur', avecCartes: ExerciceCarte[] = cartes) {
  const root = document.createElement('div');
  const onTravailler = vi.fn();
  const onBack = vi.fn();
  renderTechniqueConseils(root, { fiche: ficheConseils(id)!, cartes: avecCartes, onBack, onTravailler });
  return { root, onTravailler, onBack };
}

describe('fiches de conseils — cohérence avec le catalogue', () => {
  it('rattache chaque fiche à une famille qui existe', () => {
    const familles = new Set(cartes.map((carte) => carte.famille));
    for (const fiche of FICHES_CONSEILS) expect(familles.has(fiche.famille), fiche.id).toBe(true);
  });

  it('ne renvoie qu’à des motifs du catalogue', () => {
    const motifs = new Set(cartes.map((carte) => carte.motifId));
    for (const fiche of FICHES_CONSEILS) {
      for (const exercice of fiche.exercices) {
        for (const motif of exercice.motifs ?? []) expect(motifs.has(motif), motif).toBe(true);
      }
    }
  });

  it('trouve la fiche dominante sous la famille Dominantes', () => {
    expect(fichesDeLaFamille('Dominantes').map((fiche) => fiche.id)).toContain('dominante-vers-mineur');
    expect(fichesDeLaFamille('Gammes')).toEqual([]);
  });
});

describe('renderTechniqueConseils', () => {
  it('affiche le titre, les sections et tous les exercices numérotés', () => {
    const { root } = mount();
    const fiche = ficheConseils('dominante-vers-mineur')!;
    expect(root.querySelector('h1')?.textContent).toBe(fiche.titre);
    expect(root.querySelectorAll('ol > li')).toHaveLength(fiche.exercices.length);
    expect(root.querySelector('table')?.textContent).toContain('Do♯');
  });

  it('lance une séance sur les seules cartes des motifs de l’exercice', () => {
    const { root, onTravailler } = mount();
    const boutons = root.querySelectorAll<HTMLButtonElement>('[data-travailler]');
    expect(boutons.length).toBeGreaterThan(0);
    boutons[0]!.click();
    const lancees = onTravailler.mock.calls[0]![0] as ExerciceCarte[];
    expect(lancees.length).toBe(12);
    expect(new Set(lancees.map((carte) => carte.motifId))).toEqual(new Set(['dom-mixo-min']));
  });

  it('n’offre aucun bouton de séance quand le catalogue n’a pas les motifs', () => {
    const { root } = mount('dominante-vers-mineur', []);
    expect(root.querySelector('[data-travailler]')).toBeNull();
    expect(root.querySelectorAll('ol > li').length).toBeGreaterThan(0);
  });

  it('revient à la liste Technique', () => {
    const { root, onBack } = mount();
    root.querySelector<HTMLButtonElement>('header button')!.click();
    expect(onBack).toHaveBeenCalled();
  });
});
