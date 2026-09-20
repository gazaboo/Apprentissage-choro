/** Logique pure du lecteur : boucle A-B, vitesse, durée, pannes.
 *
 * Ces règles étaient jusqu'ici invérifiables — elles vivaient derrière une
 * iframe YouTube qu'aucun test ne pouvait piloter (#18 facilite #17). Un
 * `<audio>` se remplace par un double, ce qui les met enfin à portée.
 *
 * jsdom fournit l'élément mais aucun moteur de lecture : `play`, `pause`,
 * `load` y lèvent « not implemented », et `currentTime` / `duration` ne sont
 * pas pilotables. On installe donc un média minimal — une horloge et trois
 * drapeaux —, c'est-à-dire exactement ce que le `Player` interroge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTime, Player, type PlayerFailure } from './audio';

interface FakeMediaState {
  _time: number;
  _duration: number;
  _paused: boolean;
  _ended: boolean;
  _rate: number;
}

type FakeMedia = HTMLAudioElement & FakeMediaState;

function installFakeMedia(): void {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperties(proto, {
    currentTime: {
      configurable: true,
      get(this: FakeMedia) {
        return this._time ?? 0;
      },
      set(this: FakeMedia, value: number) {
        this._time = value;
      },
    },
    duration: {
      configurable: true,
      get(this: FakeMedia) {
        // Avant les métadonnées, un vrai élément annonce `NaN`.
        return this._duration ?? NaN;
      },
    },
    paused: {
      configurable: true,
      get(this: FakeMedia) {
        return this._paused ?? true;
      },
    },
    ended: {
      configurable: true,
      get(this: FakeMedia) {
        return this._ended ?? false;
      },
    },
    playbackRate: {
      configurable: true,
      get(this: FakeMedia) {
        return this._rate ?? 1;
      },
      set(this: FakeMedia, value: number) {
        this._rate = value;
      },
    },
  });
  proto.play = function (this: FakeMedia) {
    this._paused = false;
    return Promise.resolve();
  };
  proto.pause = function (this: FakeMedia) {
    this._paused = true;
  };
  proto.load = function () {};
}

/** Monte un lecteur et rend l'élément média qu'il pilote. */
async function mounted(duration = 200): Promise<{
  player: Player;
  media: FakeMedia;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const player = new Player();
  await player.mount(container);
  const media = container.querySelector('audio') as FakeMedia;
  media._duration = duration;
  return { player, media };
}

beforeEach(installFakeMedia);

describe('Player — boucle A-B', () => {
  it('remet les bornes dans l’ordre et impose une durée jouable', async () => {
    const { player } = await mounted();
    // Bornes données à l’envers : le geste reste valable, on le redresse.
    expect(player.setLoop(30, 12)).toEqual({ a: 12, b: 30 });
    // Bornes confondues : on écarte B plutôt que de poser une boucle vide.
    expect(player.setLoop(40, 40)).toEqual({ a: 40, b: 40.5 });
  });

  it('borne la boucle à la durée du morceau', async () => {
    const { player } = await mounted(100);
    expect(player.setLoop(80, 500)).toEqual({ a: 80, b: 100 });
  });

  it('place la lecture en A dès la pose de la boucle', async () => {
    const { player, media } = await mounted();
    media._time = 90;
    player.setLoop(10, 20);
    expect(media.currentTime).toBe(10);
  });

  it('garde un intervalle jouable quand on rapproche les bornes', async () => {
    const { player } = await mounted();
    player.setLoop(10, 11);
    // A poussé au-delà de B : c’est A qui recule, pas la boucle qui disparaît.
    expect(player.nudgeLoopPoint('a', 5)).toEqual({ a: 10.5, b: 11 });
    player.setLoop(10, 11);
    expect(player.nudgeLoopPoint('b', -5)).toEqual({ a: 10, b: 10.5 });
  });

  it('échange les bornes quand B est posé avant A', async () => {
    const { player, media } = await mounted();
    media._time = 50;
    player.markLoopPoint('a');
    media._time = 20;
    expect(player.markLoopPoint('b')).toEqual({ a: 20, b: 50 });
    // Poser B lance la boucle : on repart de A sans nouveau geste.
    expect(media.currentTime).toBe(20);
    expect(player.isPlaying()).toBe(true);
  });
});

describe('Player — ticker', () => {
  it('ramène en A au franchissement de B et ne signale le retour qu’une fois', async () => {
    vi.useFakeTimers();
    try {
      const { player, media } = await mounted();
      const ticks: { laps: number; wrapped: boolean }[] = [];
      player.onTick(({ laps, wrapped }) => ticks.push({ laps, wrapped }));

      player.setLoop(10, 20);
      media._time = 21;
      vi.advanceTimersByTime(50);
      expect(media.currentTime).toBe(10);
      expect(ticks.at(-1)).toEqual({ laps: 1, wrapped: true });

      // Battement suivant, toujours dans la boucle : plus de `wrapped`.
      media._time = 12;
      vi.advanceTimersByTime(50);
      expect(ticks.at(-1)).toEqual({ laps: 1, wrapped: false });

      media._time = 25;
      vi.advanceTimersByTime(50);
      expect(ticks.at(-1)).toEqual({ laps: 2, wrapped: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('arrête le sondage quand le dernier abonné se retire', async () => {
    vi.useFakeTimers();
    try {
      const { player } = await mounted();
      const seen = vi.fn();
      const stop = player.onTick(seen);
      vi.advanceTimersByTime(50);
      expect(seen).toHaveBeenCalledTimes(1);
      stop();
      vi.advanceTimersByTime(500);
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Player — vitesse', () => {
  it('applique n’importe quel ratio en préservant la hauteur', async () => {
    const { player, media } = await mounted();
    // 0,85 était impossible avec YouTube, qui ne connaissait que ses paliers.
    expect(player.setRate(0.85)).toBe(0.85);
    expect(media.playbackRate).toBe(0.85);
    expect(media.preservesPitch).toBe(true);
  });

  it('réapplique la vitesse au changement de source', async () => {
    const { player, media } = await mounted();
    player.setRate(0.5);
    // Charger un fichier remet `playbackRate` à 1 : sans réapplication, passer
    // au morceau suivant annulerait silencieusement le ralenti choisi.
    media._rate = 1;
    player.load('data/x/audio/playback.aaaaaaaa.opus');
    expect(media.playbackRate).toBe(0.5);
  });
});

describe('Player — durée', () => {
  it('retombe sur la durée du manifeste tant que les métadonnées manquent', async () => {
    const { player, media } = await mounted();
    media._duration = NaN;
    player.load('data/x/audio/reference.aaaaaaaa.opus', false, 187);
    expect(player.getDuration()).toBe(187);

    // Une fois les métadonnées arrivées, c’est le fichier qui fait foi.
    media._duration = 190.5;
    expect(player.getDuration()).toBe(190.5);
  });
});

describe('Player — pannes', () => {
  it('signale un fichier illisible', async () => {
    const { player, media } = await mounted();
    const failures: PlayerFailure[] = [];
    player.onFailure((failure) => failures.push(failure));
    media.dispatchEvent(new Event('error'));
    expect(failures).toEqual(['fichier']);
  });

  it('signale une lecture refusée faute de geste utilisateur', async () => {
    const { player } = await mounted();
    const failures: PlayerFailure[] = [];
    player.onFailure((failure) => failures.push(failure));
    // L’iframe YouTube héritait de la permission acquise au montage et masquait
    // ce cas ; un élément natif rejette la promesse de `play()`.
    (HTMLMediaElement.prototype as unknown as Record<string, unknown>).play = () =>
      Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    player.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(failures).toEqual(['geste']);
  });
});

describe('formatTime', () => {
  it('formate en m:ss et encaisse les valeurs absurdes', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(123.4)).toBe('2:03');
    expect(formatTime(3600)).toBe('60:00');
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});
