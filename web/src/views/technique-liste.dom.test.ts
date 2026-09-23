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
  it('rend le compte d\'exercices sans lever', () => {
    const cartes = [carte(), carte({ id: 'arp-m7::D::descendant', sens: 'descendant' })];
    const { root } = mount(cartes);
    expect(root.querySelector('h1')?.textContent).toBe('Arpèges et gammes');
    expect(root.textContent).toContain('2 exercices');
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
    expect(root.textContent).toContain('2 sur 2 à travailler');
    expect(root.textContent).not.toContain('4 sur 4 à travailler');
  });

  it('teardown ne lève pas', () => {
    const { teardown } = mount([carte()]);
    expect(() => teardown()).not.toThrow();
  });

  it('« Commencer » est désactivé et le texte change quand rien n\'est à réviser', () => {
    // Une carte technique déjà à jour (due dans le futur, historique non vide).
    const dejaVu = carte();
    const progress = baseProgress({
      cards: {
        [`tech::${dejaVu.id}`]: {
          ease: 2.5,
          interval: 30,
          repetitions: 3,
          due: '2099-01-01',
          history: [{ date: '2026-01-01', grade: 5, tempo: 'fluide', hints: 0 }],
        },
      },
    });
    const { root } = mount([dejaVu], { progress });
    const start = [...root.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Rien à réviser') || b.textContent?.startsWith('Commencer'),
    )!;
    expect(start.textContent).toBe('Rien à réviser aujourd’hui');
    expect(start.disabled).toBe(true);
  });
});

describe('renderTechniqueListe — interactions', () => {
  it('« Commencer » appelle onStart() quand des exercices restent à travailler', () => {
    const { root, context } = mount([carte()]);
    const start = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Commencer'))!;
    start.click();
    expect(context.onStart).toHaveBeenCalledOnce();
  });

  it('un chip de tonalité appelle onStartTonalite avec les cartes de cette tonalité (les deux sens)', () => {
    const montant = carte();
    const descendant = carte({ id: 'arp-m7::D::descendant', sens: 'descendant' });
    const { root, context } = mount([montant, descendant]);
    const chip = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Dm7')!;
    chip.click();
    expect(context.onStartTonalite).toHaveBeenCalledWith(
      expect.arrayContaining([montant, descendant]),
    );
  });
});
