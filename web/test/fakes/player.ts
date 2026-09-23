/** Double du `Player` de `src/audio.ts` pour les tests de vues en jsdom.
 *
 * `Player` porte des champs privés : structurellement, seule une vraie
 * instance lui est assignable. Le double est donc construit comme un objet
 * indépendant puis converti par un `as unknown as Player` — TypeScript ne
 * vérifie alors plus la forme, à charge pour ce fichier de répliquer
 * fidèlement la surface publique réellement utilisée par les vues.
 *
 * Pas de vrai minuteur : `onTick` collecte les abonnés, et c'est `__tick()`
 * qui simule un battement à la demande, avec la même logique de boucle A-B
 * que l'original (retour en A au franchissement de B, `laps` incrémenté).
 */

import type { Loop, Player, PlayerFailure, PlayerTick } from '../../src/audio';

const MIN_LOOP = 0.5;

export interface FakePlayerControls {
  __setPlaying(playing: boolean): void;
  /** Simule la fin du fichier : c'est elle qui déclenche l'enchaînement. */
  __setEnded(ended: boolean): void;
  /** Émet une panne de lecture vers les abonnés de `onFailure`. */
  __fail(failure: PlayerFailure): void;
  __setDuration(duration: number): void;
  /** Simule un battement du ticker ; `at` déplace la position avant le calcul. */
  __tick(at?: number): void;
  readonly __listenerCount: number;
}

export function createFakePlayer(): Player & FakePlayerControls {
  let currentTime = 0;
  let duration = 180;
  let playing = false;
  let loop: Loop = { a: null, b: null };
  let laps = 0;
  let rate = 1;
  const listeners = new Set<(tick: PlayerTick) => void>();
  const failureListeners = new Set<(failure: PlayerFailure) => void>();
  let ended = false;

  const clamp = (v: number): number => Math.max(0, duration ? Math.min(v, duration) : v);
  const getLoop = (): Loop => ({ ...loop });

  const fake = {
    async mount(_container: HTMLElement): Promise<void> {},

    get isReady(): boolean {
      return true;
    },

    load(_src: string, autoplay = false, knownDuration?: number): void {
      loop = { a: null, b: null };
      laps = 0;
      ended = false;
      if (knownDuration !== undefined) duration = knownDuration;
      if (autoplay) playing = true;
    },

    cue(src: string, knownDuration?: number): void {
      fake.load(src, false, knownDuration);
    },

    play(): void {
      playing = true;
    },

    pause(): void {
      playing = false;
    },

    isPlaying(): boolean {
      return playing;
    },

    hasEnded(): boolean {
      return ended;
    },

    togglePlay(): void {
      playing = !playing;
    },

    getCurrentTime(): number {
      return currentTime;
    },

    getDuration(): number {
      return duration;
    },

    seekTo(seconds: number): void {
      currentTime = clamp(seconds);
    },

    onTick(listener: (tick: PlayerTick) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onFailure(listener: (failure: PlayerFailure) => void): () => void {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },

    getLoop,

    setLoop(a: number, b: number): Loop {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      loop = { a: clamp(lo), b: clamp(Math.max(hi, lo + MIN_LOOP)) };
      laps = 0;
      currentTime = loop.a!;
      return getLoop();
    },

    markLoopPoint(point: 'a' | 'b'): Loop {
      loop = { ...loop, [point]: currentTime };
      laps = 0;
      const { a, b } = loop;
      if (a !== null && b !== null && b < a) loop = { a: b, b: a };
      if (point === 'b' && loop.a !== null) {
        currentTime = loop.a;
        playing = true;
      }
      return getLoop();
    },

    nudgeLoopPoint(point: 'a' | 'b', delta: number): Loop {
      const value = loop[point];
      if (value === null) return getLoop();
      let next = Math.max(0, value + delta);
      if (duration) next = Math.min(next, duration);
      loop = { ...loop, [point]: next };
      const { a, b } = loop;
      if (a !== null && b !== null && b - a < MIN_LOOP) {
        if (point === 'a') loop.a = Math.max(0, b - MIN_LOOP);
        else loop.b = a + MIN_LOOP;
      }
      return getLoop();
    },

    clearLoop(): Loop {
      loop = { a: null, b: null };
      laps = 0;
      return getLoop();
    },

    setRate(nextRate: number): number {
      rate = nextRate;
      return rate;
    },

    getRate(): number {
      return rate;
    },

    destroy(): void {
      listeners.clear();
      failureListeners.clear();
    },

    __setPlaying(value: boolean): void {
      playing = value;
    },

    __setEnded(value: boolean): void {
      ended = value;
      if (value) playing = false;
    },

    __fail(failure: PlayerFailure): void {
      for (const listener of failureListeners) listener(failure);
    },

    __setDuration(value: number): void {
      duration = value;
    },

    __tick(at?: number): void {
      if (at !== undefined) currentTime = at;
      let wrapped = false;
      const { a, b } = loop;
      if (a !== null && b !== null && b > a && currentTime >= b) {
        currentTime = a;
        laps += 1;
        wrapped = true;
      }
      const tick: PlayerTick = {
        currentTime,
        duration,
        playing,
        loop: getLoop(),
        laps,
        wrapped,
      };
      for (const listener of listeners) listener(tick);
    },

    get __listenerCount(): number {
      return listeners.size;
    },
  };

  return fake as unknown as Player & FakePlayerControls;
}
