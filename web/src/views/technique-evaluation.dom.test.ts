/** L'évaluation au micro, de bout en bout, sur une horloge audio simulée.
 *
 * Ce qu'on veut verrouiller ici n'est pas de l'audio mais du décompte : trois
 * passes d'un motif de N notes valent 3 × N battues, ni plus ni moins. Une
 * battue de trop — programmée pendant le délai de grâce qui suit la dernière —
 * n'a aucune note en face et se lit comme une note manquée, ce qui fausse le
 * seul chiffre que le musicien regarde (issue #54).
 *
 * Le micro est remplacé par un `PitchTracker` pilotable : le test choisit les
 * attaques, à la milliseconde près, ce qu'aucun micro réel ne permettrait.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Onset } from '../pitch';
import { installFakeAudio } from '../../test/fakeAudio';

/** Instances créées par la vue, dans l'ordre : [0] évaluation, [1] test micro. */
const trackers: FakeTracker[] = [];

class FakeTracker {
  listening = false;
  constructor(
    _context: unknown,
    readonly onOnset: (onset: Onset) => void,
    readonly onLevel?: (level: number) => void,
  ) {
    trackers.push(this);
  }

  async start(): Promise<void> {
    this.listening = true;
  }

  stop(): void {
    this.listening = false;
  }

  destroy(): void {
    this.stop();
  }
}

vi.mock('../pitch', () => ({ PitchTracker: FakeTracker }));

const { renderTechnique } = await import('./technique');
const { DEFAULT_BPM } = await import('../technique/catalogue');
type TechniqueContext = Parameters<typeof renderTechnique>[1];
type ExerciceCarte = TechniqueContext['ordre'][number];
const { getTechniqueCard } = await import('../store');
type Progress = Parameters<typeof getTechniqueCard>[0];

/** Motif de 4 notes : 3 passes valent 12 battues. */
function carte(): ExerciceCarte {
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
  };
}

function baseProgress(): Progress {
  return {
    cards: {},
    setlists: [],
    activeSetlistId: null,
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
  };
}

const PASSES = 3;
const MOTIF = carte().midi;
/** Retard imposé par `Metronome.start()` avant la première battue. */
const AMORCE_S = 0.15;
const COUNT_IN = 4;
const BEAT_S = 60 / DEFAULT_BPM;
/** Instant audio de la première battue jouée (après le décompte). */
const PREMIERE_S = AMORCE_S + COUNT_IN * BEAT_S;

let restoreAudio: () => void;

beforeEach(() => {
  trackers.length = 0;
  restoreAudio = installFakeAudio();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreAudio();
  document.body.innerHTML = '';
});

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const context: TechniqueContext = {
    progress: baseProgress(),
    ordre: [carte()],
    markWorked: vi.fn(),
    navigateBack: vi.fn(),
    onFinish: vi.fn(),
  };
  const teardown = renderTechnique(root, context);
  return { root, context, teardown };
}

function bouton(root: HTMLElement, texte: string): HTMLButtonElement {
  return [...root.querySelectorAll('button')].find(
    (b) => b.textContent === texte,
  ) as HTMLButtonElement;
}

describe('renderTechnique — décompte des battues évaluées', () => {
  it('s’arrête à 3 × N battues, sans battue fantôme pendant le délai de grâce', async () => {
    const { root, teardown } = mount();
    bouton(root, 'Évaluation au micro').click();
    // Laisse `getUserMedia` et `metronome.start()` se résoudre.
    await vi.advanceTimersByTimeAsync(0);
    expect(trackers[0]?.listening).toBe(true);

    // Décompte de préparation, puis les 3 passes, jusqu'à la dernière battue.
    const total = PASSES * MOTIF.length;
    await vi.advanceTimersByTimeAsync((PREMIERE_S + (total - 1) * BEAT_S) * 1000 + 50);

    // Une attaque juste sur chaque battue jouée, rien d'autre. Toutes d'un
    // coup : `noter()` ne lit que leurs instants.
    for (let i = 0; i < total; i += 1) {
      trackers[0]?.onOnset({
        audioTime: PREMIERE_S + i * BEAT_S,
        midi: MOTIF[i % MOTIF.length]!,
        clarte: 1,
      });
    }

    // Le délai de grâce (une battue) expire et déclenche la notation.
    await vi.advanceTimersByTimeAsync(2 * BEAT_S * 1000);

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    // 12 battues, 12 notes justes — et surtout pas « sur 13 ».
    expect(dialog.textContent).toContain(`${total} notes justes sur ${total}`);
    expect(dialog.textContent).toContain(`${total} dans le tempo`);
    // Tout est juste et en place : aucune ligne de détail à montrer.
    expect(dialog.querySelector('.max-h-40')).toBeNull();

    bouton(dialog, 'Passer').click();
    await vi.advanceTimersByTimeAsync(0);
    teardown();
  });

  it('détaille les notes à vérifier, une ligne par note, sans interpréter', async () => {
    const { root, teardown } = mount();
    bouton(root, 'Évaluation au micro').click();
    await vi.advanceTimersByTimeAsync(0);

    const total = PASSES * MOTIF.length;
    await vi.advanceTimersByTimeAsync((PREMIERE_S + (total - 1) * BEAT_S) * 1000 + 50);

    for (let i = 0; i < total; i += 1) {
      // Passe 2 temps 2 (battue 5) : rien joué. Passe 3 temps 1 (battue 8) :
      // bonne note, mais 400 ms en retard — une dérive, pas une faute.
      if (i === 5) continue;
      const retard = i === 8 ? 0.4 : 0;
      trackers[0]?.onOnset({
        audioTime: PREMIERE_S + i * BEAT_S + retard,
        midi: MOTIF[i % MOTIF.length]!,
        clarte: 1,
      });
    }

    await vi.advanceTimersByTimeAsync(2 * BEAT_S * 1000);

    const detail = document.body.querySelector('.max-h-40') as HTMLElement;
    expect(detail).toBeTruthy();
    expect(detail.textContent).toContain('Passe 2, temps 2 — attendu F4, rien entendu');
    expect(detail.textContent).toContain('Passe 3, temps 1 — D4 juste, mais décalé de 400 ms');
    // Les notes justes et en place ne sont pas listées : deux lignes, pas douze.
    expect(detail.querySelectorAll('p')).toHaveLength(2);

    bouton(document.body, 'Passer').click();
    await vi.advanceTimersByTimeAsync(0);
    teardown();
  });
});
