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

/** Menu « Affichage » de la barre du haut (#153) : premier des deux
 *  exemplaires, l'autre vit dans la barre de plein écran. */
const affichageMenu = (root: HTMLElement) =>
  root.querySelector('header [role="dialog"][aria-label="Affichage"]') as HTMLElement;
const menuButton = (root: HTMLElement, text: string) =>
  [...affichageMenu(root).querySelectorAll('button')].find((b) => b.textContent === text)!;

/** Ouvre le tiroir Réglages par le lien du menu « Affichage » (#153). */
function openReglages(root: HTMLElement): HTMLElement {
  [...affichageMenu(root).querySelectorAll('button')]
    .find((b) => b.textContent?.startsWith('Défi et autres réglages'))!
    .click();
  // Le panneau (`sheet.ts`) vit dans `document.body`, pas dans `root`
  // (`createControlBar` y ajoute son overlay séparément).
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  // `createControlBar` (sheet.ts) ajoute son panneau à `document.body`, hors
  // de `root`, à chaque montage — jamais nettoyé sinon : un test qui cherche
  // `document.body.querySelector('[role="dialog"]')` tomberait sur le
  // panneau d'un test précédent plutôt que le sien.
  document.body.replaceChildren();
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
    const back = root.querySelector('button[aria-label="Retour"]') as HTMLButtonElement;
    back.click();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });
});

describe('renderTrainer — bascule contre-chant (#80)', () => {
  it('le morceau sans contraponto ne montre pas la bascule', () => {
    const { root } = mount({ contraponto: null });
    // Rubrique « Portées » du menu « Affichage » repliée, non retirée (#153).
    expect(menuButton(root, '+ contre-chant').closest('section')?.classList.contains('hidden')).toBe(true);
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

    const avec = menuButton(root, '+ contre-chant');
    expect(avec.closest('section')?.classList.contains('hidden')).toBe(false);
    avec.click();
    const images = [...root.querySelectorAll('img')];
    expect(images).toHaveLength(2);
    expect(images[0]!.src).toContain('/contraponto/');
    expect(context.progress.settings.contrechant).toBe('avec');

    menuButton(root, 'Mélodie seule').click();
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(context.progress.settings.contrechant).toBe('sans');
  });
});

describe('renderTrainer — évaluation de fin (askSrs)', () => {
  it('« Terminer et évaluer » ouvre la modale, « Passer » n\'enregistre rien et revient à l\'accueil', async () => {
    const { root, context } = mount();
    const finish = root.querySelector('button[aria-label="Terminer et évaluer"]') as HTMLButtonElement;
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
    const finish = root.querySelector('button[aria-label="Terminer et évaluer"]') as HTMLButtonElement;
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
    const finish = root.querySelector(
      'button[aria-label="Passer au morceau suivant"]',
    ) as HTMLButtonElement;
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

describe('renderTrainer — barre du haut (#153)', () => {
  const session = (onStopSession = vi.fn()) => ({
    kind: 'urgent' as const,
    label: 'Révision des urgences · Concert — morceau 2 sur 3',
    caption: { kind: 'Urgences', position: '2 sur 3' },
    blockMinutes: null,
    onBlockEnd: vi.fn(),
    onStopSession,
  });

  it('la légende dit l\'état du morceau hors séance, et le rang en séance', () => {
    expect(mount().root.querySelector('header')!.textContent).toContain('Jamais travaillé');
    const { root } = mount({}, { session: session() });
    expect(root.querySelector('header')!.textContent).toContain('Urgences · 2 sur 3');
  });

  it('« Terminer la séance » ne vit plus à côté de « Suivant » : dans le panneau du titre', async () => {
    const onStopSession = vi.fn();
    const { root } = mount({}, { session: session(onStopSession) });
    const header = root.querySelector('header')!;
    const direct = [...header.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Terminer la séance' && !b.closest('[role="dialog"]'),
    );
    expect(direct).toHaveLength(0);

    const stop = header.querySelector('[role="dialog"] button[aria-label="Terminer la séance"]') as HTMLButtonElement;
    stop.click();
    await Promise.resolve();
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!.click();
    await Promise.resolve();
    expect(onStopSession).toHaveBeenCalledOnce();
  });

  it('le menu « Affichage » change la tonalité, repeinte des deux côtés', () => {
    const { root } = mount({
      instruments: [
        { id: 'c', name: 'Ut', page_count: 0, measure_count: 0, pages: [] },
        { id: 'bb', name: 'Si♭', page_count: 0, measure_count: 0, pages: [] },
      ],
    });
    menuButton(root, 'Si♭ / B♭').click();
    const menus = [...root.querySelectorAll('[role="dialog"][aria-label="Affichage"]')];
    // Barre du haut et barre de plein écran.
    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      const bb = [...menu.querySelectorAll('button')].find((b) => b.textContent === 'Si♭ / B♭')!;
      expect(bb.dataset.state).toBe('on');
    }
  });
});

describe('renderTrainer — écran Consigne et mode recommandé (#109)', () => {
  /** Deux Good/Easy, nombre pair de révisions : `recommendedMode` → 'sans'.
   *  `studyMode: 'eclipses'` (distinct de 'sans'/'mesures') pour que les
   *  assertions « rien n'a été persisté » soient probantes. */
  function masteredProgress(): Progress {
    return baseProgress({
      settings: { ...baseProgress().settings, studyMode: 'eclipses' },
      cards: {
        'choro-a::c': {
          ease: 2.5,
          interval: 6,
          repetitions: 2,
          due: '2026-09-21',
          history: [
            { date: '2026-09-01', grade: 5, tempo: 'fluide', hints: 0 },
            { date: '2026-09-10', grade: 5, tempo: 'fluide', hints: 0 },
          ],
        },
      },
    });
  }

  it('s\'affiche par défaut quand le mode recommandé est \'sans\', sans toucher au réglage persisté', () => {
    const { root, context } = mount({}, { progress: masteredProgress() });
    expect(root.textContent).toContain('Consigne');
    expect(root.textContent).toContain('Ce défi est réversible');
    expect(
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Partition masquée à 75 %'),
    ).toBeTruthy();
    expect(context.progress.settings.studyMode).toBe('eclipses');
  });

  it('le Défi reste joignable en mode \'sans\', contrairement aux bascules de l\'en-tête', () => {
    const { root } = mount({}, { progress: masteredProgress() });
    // Le menu « Affichage » reste en place, et dit « Sans partition » ; son
    // lien mène au Défi (#109, #153).
    const trigger = root.querySelector('button[aria-label="Affichage de la partition"]') as HTMLButtonElement;
    expect(trigger.closest('.hidden')).toBeNull();
    expect(trigger.textContent).toContain('Sans partition');
    expect(openReglages(root).textContent).toContain('Partition masquée à 75 %');
    const fullscreen = root.querySelector(
      'button[aria-label="Passer en plein écran"]',
    ) as HTMLButtonElement;
    expect(fullscreen.closest('.hidden')).not.toBeNull();
  });

  it('un bouton d\'aide sort du mode \'sans\' sans écrire studyMode ni maskLevel dans les réglages', () => {
    const { root, context } = mount({}, { progress: masteredProgress() });
    const aide75 = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Partition masquée à 75 %',
    )!;
    aide75.click();

    const consigne = [...root.querySelectorAll('h2')].find((h) => h.textContent === 'Consigne')!
      .parentElement!;
    expect(consigne.classList.contains('hidden')).toBe(true);
    expect(context.progress.settings.studyMode).toBe('eclipses');
    expect(context.progress.settings.maskLevel).toBe(50); // valeur d'origine de baseProgress, inchangée
  });

  it('le bouton « Défi » du dock (choix explicite), lui, persiste bien le mode choisi', () => {
    const progress = masteredProgress();
    progress.settings.studyMode = 'mesures'; // distinct du mode ciblé, pour que la persistance soit probante
    const { root, context } = mount({}, { progress });
    const panel = openReglages(root);
    const masque75 = [...panel.querySelectorAll('button')].find(
      (b) => b.textContent === 'Partition masquée à 75 %',
    )!;
    masque75.click();
    expect(context.progress.settings.studyMode).toBe('mesures');
    expect(context.progress.settings.maskLevel).toBe(75);
    const consigne = [...root.querySelectorAll('h2')].find((h) => h.textContent === 'Consigne')!
      .parentElement!;
    expect(consigne.classList.contains('hidden')).toBe(true);
  });

  it('un choix Défi qui coïncide avec le mode courant (mais pas encore persisté) persiste quand même (relecture #131)', () => {
    // `baseProgress` persiste `studyMode: 'mesures'`, mais une carte neuve
    // (aucun historique) fait recommander 'entiere' à l'ouverture : les deux
    // divergent dès le montage, sans qu'aucun choix n'ait encore été fait.
    const { root, context } = mount();
    const panel = openReglages(root);
    const entiere = [...panel.querySelectorAll('button')].find(
      (b) => b.textContent === 'Afficher la partition entière',
    )!;
    // Le mode courant en mémoire est déjà 'entiere' : avant #131, la garde
    // `next === mode` de `setMode` empêchait ce choix, pourtant explicite,
    // de jamais s'écrire dans `progress.settings.studyMode`.
    entiere.click();
    expect(context.progress.settings.studyMode).toBe('entiere');
  });

  it('demander de l\'aide plafonne la note présélectionnée à 3 en fin de morceau', async () => {
    const { root, context } = mount({}, { progress: masteredProgress() });
    const aideEntiere = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Afficher la partition entière',
    )!;
    aideEntiere.click();

    const finish = root.querySelector('button[aria-label="Terminer et évaluer"]') as HTMLButtonElement;
    finish.click();
    await Promise.resolve();

    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement;
    // `data-state` et non la classe de couleur : l'état présélectionné est ce
    // qu'on vérifie ici, pas la palette qui l'exprime (#137).
    const three = dialog.querySelector('button[aria-label="Correct — quelques hésitations"]');
    expect(three?.getAttribute('data-state')).toBe('on');
    const five = dialog.querySelector('button[aria-label="Parfait — sans aucun indice"]') as HTMLButtonElement;
    expect(five.dataset.state).toBe('off');

    const skip = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Passer')!;
    skip.click();
    await Promise.resolve();
    expect(context.navigateHome).toHaveBeenCalledOnce();
  });
});
