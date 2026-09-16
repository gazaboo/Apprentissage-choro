/** Contexte audio minimal pour les tests jsdom.
 *
 * `Metronome` et `PitchTracker` ne demandent au contexte que deux choses :
 * une horloge (`currentTime`) et des nœuds à câbler. On donne l'horloge — la
 * seule qui compte, puisque tout le calage du projet s'y réfère — et des
 * nœuds inertes pour le reste. L'horloge suit les faux timers de vitest, qui
 * mockent aussi `Date.now()` : avancer les timers avance le temps audio, et
 * une séance entière se déroule en quelques millisecondes réelles.
 */
export class FakeAudioContext {
  state = 'running';
  readonly destination = { connect: () => this.destination };
  private readonly origin = Date.now();

  get currentTime(): number {
    return (Date.now() - this.origin) / 1000;
  }

  get sampleRate(): number {
    return 44100;
  }

  createOscillator(): unknown {
    return {
      frequency: { value: 0 },
      connect: (next: { connect: unknown }) => next,
      start: () => {},
      stop: () => {},
    };
  }

  createGain(): unknown {
    return {
      gain: {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: (next: unknown) => next,
    };
  }

  async resume(): Promise<void> {}

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

/** Installe le faux contexte, et rend de quoi le désinstaller. */
export function installFakeAudio(): () => void {
  const previous = Reflect.get(globalThis, 'AudioContext');
  Reflect.set(globalThis, 'AudioContext', FakeAudioContext);
  return () => Reflect.set(globalThis, 'AudioContext', previous);
}
