import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTrainer, type TrainerContext } from './trainer';
import { createFakePlayer } from '../../test/fakes/player';
import type { Progress } from '../store';
import type { Song } from '../types';

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'choro-a',
    title: 'Choro de test',
    composer: 'Compositeur',
    audio: { reference: null, playback: null },
    instruments: [{ id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] }],
    contraponto: null,
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

function mount(songOverrides: Partial<Song> = {}, contextOverrides: Partial<TrainerContext> = {}) {
  const root = document.createElement('div');
  const player = createFakePlayer();
  const context: TrainerContext = {
    progress: baseProgress(),
    player,
    navigateHome: vi.fn(),
    ...contextOverrides,
  };
  const teardown = renderTrainer(root, song(songOverrides), context);
  return { root, context, player, teardown };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderTrainer — smoke', () => {
  it('rend le titre du morceau sans lever', () => {
    const { root } = mount();
    expect(root.querySelector('h1')?.textContent).toBe('Choro de test');
  });

  it("affiche l'avertissement d'absence d'audio quand le morceau n'a ni référence ni playback", () => {
    const { root } = mount();
    expect(root.textContent).toContain('Aucune vidéo disponible pour ce morceau');
  });

  it('teardown ne lève pas et ne laisse aucun abonné du ticker du lecteur', async () => {
    const { teardown, player } = mount();
    await Promise.resolve();
    expect(() => teardown()).not.toThrow();
    expect(player.__listenerCount).toBe(0);
  });
});

describe('renderTrainer — mini-lecteur (fpMiniBar)', () => {
  it('un battement du lecteur met à jour le temps affiché', () => {
    const { root, player } = mount();
    player.__setDuration(120);
    player.__tick(30);
    const time = [...root.querySelectorAll('span')].find((s) => s.textContent === '0:30 / 2:00');
    expect(time).toBeDefined();
  });

  it('cliquer le mini bouton lecture bascule play/pause du lecteur', () => {
    const { root, player } = mount();
    // Sans audio, le bouton de la barre de transport principale est
    // `disabled` : seul le mini-bouton (`fpMiniBar`) reste actionnable.
    const playButton = root.querySelector(
      'button[aria-label="Lecture ou pause"]:not([disabled])',
    ) as HTMLButtonElement;
    expect(player.isPlaying()).toBe(false);
    playButton.click();
    expect(player.isPlaying()).toBe(true);
  });
});

describe('renderTrainer — retour et navigation', () => {
  it('« Retour » appelle navigateHome() sans passer par l\'évaluation', () => {
    const { root, context } = mount();
    const back = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retour')!;
    back.click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });
});

describe('renderTrainer — bascule contre-chant (#80)', () => {
  it('le morceau sans contraponto ne montre pas la bascule', () => {
    const { root } = mount({ contraponto: null });
    const button = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mélodie et contre-chant',
    )!;
    expect(button.parentElement?.classList.contains('hidden')).toBe(true);
  });

  it('le morceau avec contraponto bascule le rendu et enregistre le choix', () => {
    const { root, context } = mount({
      instruments: [
        {
          id: 'c',
          name: 'Ut',
          page_count: 1,
          measure_count: 1,
          pages: [
            {
              page_number: 1,
              image_path: 'data/choro-a/c/page_1.webp',
              measures_source: 'vector',
              measures: [],
            },
          ],
        },
      ],
      contraponto: {
        page_count: 2,
        measure_count: 2,
        pages: [
          {
            page_number: 1,
            image_path: 'data/choro-a/contraponto/page_1.webp',
            measures_source: 'vector',
            measures: [],
          },
          {
            page_number: 2,
            image_path: 'data/choro-a/contraponto/page_2.webp',
            measures_source: 'vector',
            measures: [],
          },
        ],
      },
    });

    expect(root.querySelectorAll('img')).toHaveLength(1);

    const avec = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mélodie et contre-chant',
    )!;
    avec.click();
    const images = [...root.querySelectorAll('img')];
    expect(images).toHaveLength(2);
    expect(images[0]!.src).toContain('/contraponto/');
    expect(context.progress.settings.contrechant).toBe('avec');

    const seul = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Mélodie seule',
    )!;
    seul.click();
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(context.progress.settings.contrechant).toBe('sans');
  });
});

describe('renderTrainer — évaluation de fin (askSrs)', () => {
  it('« Terminer et évaluer » ouvre la modale, « Passer » n\'enregistre rien et revient à l\'accueil', async () => {
    const { root, context } = mount();
    const finish = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Terminer et évaluer')!;
    finish.click();
    await Promise.resolve();

    // `controlBar` (réglages, sheet.ts) porte aussi `role="dialog"` en
    // permanence : seule la modale d'auto-évaluation est `aria-modal="true"`.
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    const skip = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!;
    skip.click();
    await Promise.resolve();

    expect(context.navigateHome).toHaveBeenCalledOnce();
    expect(context.progress.cards['choro-a::c']).toBeUndefined();
  });

  it('« Enregistrer » dans la modale écrit la carte SRS puis revient à l\'accueil', async () => {
    const { root, context } = mount();
    const finish = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Terminer et évaluer')!;
    finish.click();
    await Promise.resolve();

    // `controlBar` (réglages, sheet.ts) porte aussi `role="dialog"` en
    // permanence : seule la modale d'auto-évaluation est `aria-modal="true"`.
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const gradeFive = dialog.querySelector('button[aria-label="Parfait — sans aucun indice"]') as HTMLButtonElement;
    gradeFive.click();
    const validate = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
    validate.click();
    await Promise.resolve();

    expect(context.progress.cards['choro-a::c']).toBeDefined();
    expect(context.progress.cards['choro-a::c']!.history.at(-1)!.grade).toBe(5);
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });

  it('en séance, "Passer au morceau suivant" appelle onBlockEnd plutôt que navigateHome', async () => {
    const onBlockEnd = vi.fn();
    const { root, context } = mount(
      {},
      {
        session: {
          kind: 'deep',
          label: 'Travail de fond — morceau 1 sur 3',
          blockMinutes: null,
          onBlockEnd,
          onStopSession: vi.fn(),
        },
      },
    );
    const finish = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Passer au morceau suivant',
    )!;
    finish.click();
    await Promise.resolve();
    // `controlBar` (réglages, sheet.ts) porte aussi `role="dialog"` en
    // permanence : seule la modale d'auto-évaluation est `aria-modal="true"`.
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    const skip = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!;
    skip.click();
    await Promise.resolve();

    expect(onBlockEnd).toHaveBeenCalledOnce();
    expect(context.navigateHome).not.toHaveBeenCalled();
  });
});
