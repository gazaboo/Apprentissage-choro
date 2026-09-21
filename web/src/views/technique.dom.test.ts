import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderTechnique, type TechniqueContext } from './technique';
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

function mount(ordre: ExerciceCarte[], overrides: Partial<TechniqueContext> = {}) {
  const root = document.createElement('div');
  const context: TechniqueContext = {
    progress: baseProgress(),
    ordre,
    markWorked: vi.fn(),
    navigateBack: vi.fn(),
    onFinish: vi.fn(),
    ...overrides,
  };
  const teardown = renderTechnique(root, context);
  return { root, context, teardown };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderTechnique — smoke', () => {
  it('affiche le premier exercice sans lever le métronome (audio créé au premier geste)', () => {
    const { root } = mount([carte(), carte({ id: 'arp-m7::D::descendant', sens: 'descendant' })]);
    expect(root.textContent).toContain('exercice 1 sur 2');
    expect(root.textContent).toContain('Dm7');
  });

  it('teardown ne lève pas sans qu\'aucun geste audio/micro n\'ait eu lieu', () => {
    const { teardown } = mount([carte()]);
    expect(() => teardown()).not.toThrow();
  });

  it('« Voir les notes » révèle les noms des notes (masqués par défaut)', () => {
    const { root } = mount([carte()]);
    const reveal = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Voir les notes')!;
    const notesRow = root.querySelector('.mx-auto.flex.w-max') as HTMLElement;
    expect(notesRow.textContent).toBe('••••');
    reveal.click();
    expect(notesRow.textContent).toBe('DFAC');
  });

  it('« Retour » appelle navigateBack() sans ouvrir l\'évaluation', () => {
    const { root, context } = mount([carte()]);
    const back = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retour')!;
    back.click();
    expect(context.navigateBack).toHaveBeenCalledOnce();
  });
});

describe('renderTechnique — évaluation de fin', () => {
  it('« Noter et continuer » (dernier exercice) ouvre la modale puis appelle onFinish après notation', async () => {
    const { root, context } = mount([carte()]);
    const finish = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Noter et continuer')!;
    finish.click();
    await Promise.resolve();

    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    const skip = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!;
    skip.click();
    await Promise.resolve();

    expect(context.onFinish).toHaveBeenCalledOnce();
    expect(context.markWorked).not.toHaveBeenCalled();
  });

  it('« Enregistrer » avec une note marque l\'exercice comme travaillé', async () => {
    const { root, context } = mount([carte()]);
    const finish = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Noter et continuer')!;
    finish.click();
    await Promise.resolve();

    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const validate = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
    validate.click();
    await Promise.resolve();

    expect(context.markWorked).toHaveBeenCalledWith('arp-m7::D::montant');
    expect(context.onFinish).toHaveBeenCalledOnce();
  });
});

describe('renderTechnique — test du micro', () => {
  it('propose un test du micro, distinct de l\'évaluation', () => {
    const { root } = mount([carte()]);
    const test = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Tester le micro',
    ) as HTMLButtonElement;
    expect(test).toBeTruthy();
    expect(test.getAttribute('aria-pressed')).toBe('false');
    expect(test.disabled).toBe(false);
    // Le relevé du test est bien là, mais masqué tant qu'il ne tourne pas.
    const releve = root.querySelector('.flex-col.gap-2') as HTMLElement;
    expect(releve.textContent).toContain('Micro : jouez une note…');
    expect(releve.classList.contains('hidden')).toBe(true);
  });

  it('n\'ouvre ni métronome ni modale quand le micro est indisponible', async () => {
    // jsdom n'a pas d'`AudioContext` : le test échoue là où il échouerait sur
    // un appareil sans micro, ce qui est précisément le cas à signaler.
    const { root } = mount([carte()]);
    const test = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Tester le micro',
    ) as HTMLButtonElement;
    test.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('Micro indisponible');
    expect((root.querySelector('.flex-col.gap-2') as HTMLElement).classList).toContain('hidden');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    // Rien n'a démarré : « Démarrer le métronome » est toujours proposé.
    const play = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Démarrer le métronome',
    ) as HTMLButtonElement;
    expect(play.disabled).toBe(false);
  });
});
