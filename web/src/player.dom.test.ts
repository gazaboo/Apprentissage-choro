import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SequencePlayer } from './player';

vi.mock('./technique/piano', () => ({
  loadPianoSamples: async () => new Map(),
  sampleFor: () => ({ buffer: {} as AudioBuffer, playbackRate: 1 }),
}));

/** Nœuds inertes : seule compte l'horloge (`currentTime`), câlée sur les faux
 * timers de vitest comme dans `test/fakeAudio.ts`. */
class FakeAudioContext {
  private readonly origin = Date.now();
  readonly destination = {};

  get currentTime(): number {
    return (Date.now() - this.origin) / 1000;
  }

  createBufferSource(): unknown {
    const node = {
      buffer: null,
      playbackRate: { value: 1 },
      connect: () => node,
      start: () => {},
      stop: () => {},
    };
    return node;
  }

  createGain(): unknown {
    const node = {
      gain: {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        cancelScheduledValues: () => {},
      },
      connect: () => node,
    };
    return node;
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Régression #77 : activer « Boucle » pendant qu'« Écouter » joue déjà ne
// faisait rien tant que la lecture n'était pas relancée — `SequencePlayer`
// capturait le bouclage une fois pour toutes dans `start()`.
describe('SequencePlayer.setLoop', () => {
  it('fait boucler une lecture déjà démarrée sans bouclage', async () => {
    const onNote = vi.fn();
    const onDone = vi.fn();
    const player = new SequencePlayer(new FakeAudioContext() as unknown as AudioContext, {
      onNote,
      onDone,
    });

    await player.start([60, 62], 120, false);
    // Change le bouclage tôt dans la lecture, avant la fin de la séquence.
    player.setLoop(true);

    await vi.advanceTimersByTimeAsync(3000);

    expect(onDone).not.toHaveBeenCalled();
    // Sans le correctif, la lecture s'arrête après les 2 notes (index 0 et 1) ;
    // avec le bouclage pris en compte à chaud, l'index 0 est rejoué.
    const indices = onNote.mock.calls.map(([index]) => index);
    expect(indices.filter((index) => index === 0).length).toBeGreaterThan(1);

    player.stop();
  });

  it('arrête de boucler une lecture démarrée avec bouclage', async () => {
    const onNote = vi.fn();
    const onDone = vi.fn();
    const player = new SequencePlayer(new FakeAudioContext() as unknown as AudioContext, {
      onNote,
      onDone,
    });

    await player.start([60, 62], 120, true);
    player.setLoop(false);

    await vi.advanceTimersByTimeAsync(3000);

    expect(onDone).toHaveBeenCalledOnce();
  });
});
