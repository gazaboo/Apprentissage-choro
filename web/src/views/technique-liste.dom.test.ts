import { describe, expect, it, vi } from 'vitest';
import { renderTechniqueListe, type TechniqueListeContext } from './technique-liste';
import type { Progress } from '../store';
import type { ExerciceCarte } from '../technique/catalogue';

function carte(overrides: Partial<ExerciceCarte> = {}): ExerciceCarte {
  return {
    id: 'arp-m7::D::montant',
    motifId: 'arp-m7',
    famille: 'Arpèges',
    nom: 'Arpège m7',
    accord: 'Dm7',
    sens: 'montant',
    notes: ['D', 'F', 'A', 'C'],
    midi: [62, 65, 69, 72],
    noteDeTravail: null,
    ...overrides,
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
  };
}

function mount(cartes: ExerciceCarte[], overrides: Partial<TechniqueListeContext> = {}) {
  const root = document.createElement('div');
  const context: TechniqueListeContext = {
    progress: baseProgress(),
    cartes,
    onStart: vi.fn(),
    onStartTonalite: vi.fn(),
    ...overrides,
  };
  const teardown = renderTechniqueListe(root, context);
  return { root, context, teardown };
}

describe('renderTechniqueListe — smoke', () => {
  it('rend le titre et le compte de tonalités sans lever', () => {
    const cartes = [carte(), carte({ id: 'arp-m7::D::descendant', sens: 'descendant' })];
    const { root } = mount(cartes);
    expect(root.querySelector('h1')?.textContent).toBe('Technique');
    expect(root.textContent).toContain('1 tonalité · 0 travaillée');
  });

  it('compte les tonalités, pas les cartes (une gamme a un sens montant et un descendant par tonalité)', () => {
    // Régression #72 : « 24 sur 24 à travailler » pour 12 tonalités réelles —
    // le compte prenait les cartes (12 tonalités × 2 sens) au lieu des
    // pastilles affichées (une par tonalité).
    const cartes = ['D', 'E'].flatMap((root) => [
      carte({ id: `gamme::${root}::montant`, motifId: 'gamme', accord: root, sens: 'montant' }),
      carte({
        id: `gamme::${root}::descendant`,
        motifId: 'gamme',
        accord: root,
        sens: 'descendant',
      }),
    ]);
    const { root } = mount(cartes);
    expect(root.textContent).toContain('2 tonalités');
    expect(root.textContent).toContain('0/2');
    expect(root.textContent).not.toContain('4 tonalités');
  });

  it('teardown ne lève pas', () => {
    const { teardown } = mount([carte()]);
    expect(() => teardown()).not.toThrow();
  });

  it('« Commencer » est désactivé et la carte le dit quand rien n\'est prioritaire', () => {
    // Une carte technique déjà à jour (due dans le futur, historique non vide).
    const dejaVu = carte();
    const progress = baseProgress({
      cards: {
        [`tech::${dejaVu.id}`]: {
          ease: 2.5,
          interval: 30,
          repetitions: 3,
          due: '2099-01-01',
          history: [{ date: '2026-01-01', grade: 5, tempo: 'fluide', hints: 0, bpm: 84 }],
        },
      },
    });
    const { root } = mount([dejaVu], { progress });
    const start = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Commencer la séance')!;
    expect(start.disabled).toBe(true);
    expect(root.textContent).toContain('Rien de prioritaire aujourd’hui');
  });
});

describe('renderTechniqueListe — carte « Exercices prioritaires »', () => {
  it('regroupe les sens d’une même tonalité sur une ligne', () => {
    const montant = carte();
    const descendant = carte({ id: 'arp-m7::D::descendant', sens: 'descendant' });
    const { root } = mount([montant, descendant]);
    const card = root.querySelector('section[aria-label="Exercices prioritaires"]')!;
    expect([...card.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Arpège m7 · Dm7 ↑↓']);
  });

  it('« Commencer » lance exactement les exercices annoncés', () => {
    const montant = carte();
    const { root, context } = mount([montant]);
    const start = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Commencer la séance')!;
    start.click();
    expect(context.onStart).toHaveBeenCalledWith([montant]);
  });

  it('au-delà de cinq lignes, annonce le reste sans le détailler', () => {
    const cartes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((accord) =>
      carte({ id: `gamme::${accord}::montant`, motifId: 'gamme', accord }),
    );
    const { root } = mount(cartes);
    const card = root.querySelector('section[aria-label="Exercices prioritaires"]')!;
    // `pickExercices` plafonne les cartes neuves à cinq par séance.
    expect(card.querySelectorAll('li')).toHaveLength(5);
  });
});

describe('renderTechniqueListe — catalogue', () => {
  it('un motif se replie par défaut et se déplie au toucher', () => {
    const { root } = mount([carte()]);
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Dm7')).toBe(false);
    const toggle = root.querySelector('[aria-expanded="false"][aria-controls]') as HTMLButtonElement;
    toggle.click();
    expect(root.querySelector('[aria-controls]')?.getAttribute('aria-expanded')).toBe('true');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'Dm7')).toBe(true);
  });

  it('un chip de tonalité appelle onStartTonalite avec les cartes de cette tonalité (les deux sens)', () => {
    const montant = carte();
    const descendant = carte({ id: 'arp-m7::D::descendant', sens: 'descendant' });
    const { root, context } = mount([montant, descendant]);
    (root.querySelector('[aria-controls]') as HTMLButtonElement).click();
    const chip = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Dm7')!;
    chip.click();
    expect(context.onStartTonalite).toHaveBeenCalledWith(
      expect.arrayContaining([montant, descendant]),
    );
  });
});
