/** Lecteur YouTube audio seul, transport et boucle A-B.
 *
 * L'API IFrame ne se charge qu'une fois pour toute la session ; changer de
 * source ou de morceau réutilise le même lecteur via `loadVideoById`, ce qui
 * évite le clignotement d'un remontage d'iframe.
 *
 * L'iframe est rendue invisible par le CSS (`.yt-audio-only`) : on ne garde
 * que le son. Elle reste dans le flux de rendu — la masquer par `display:none`
 * ou `visibility:hidden` coupe l'audio sur certains navigateurs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type YTPlayer = any;

const API_SRC = 'https://www.youtube.com/iframe_api';

/** Période du sondage de position : assez fine pour caler une boucle. */
const TICK_MS = 100;

/** Durée minimale d'une boucle : en deçà, elle n'est plus jouable. */
const MIN_LOOP = 0.5;

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) {
      resolve();
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () =>
      reject(new Error("L'API YouTube n'a pas pu être chargée."));
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** État transmis à chaque battement du ticker. */
export interface PlayerTick {
  currentTime: number;
  duration: number;
  playing: boolean;
  loop: Loop;
  /** Nombre de retours en A depuis la pose de la boucle. */
  laps: number;
  /** Vrai sur le seul battement où la lecture vient d'être ramenée en A. */
  wrapped: boolean;
}

/** Bornes de la boucle A-B ; `null` tant que le point n'est pas posé. */
export interface Loop {
  a: number | null;
  b: number | null;
}

export class Player {
  private player: YTPlayer | null = null;
  private ready = false;
  private pendingVideoId: string | null = null;
  private countdownTimers: number[] = [];

  /** Un seul intervalle pour toute l'application (seek bar, temps, boucle). */
  private tickId: number | null = null;
  private listeners = new Set<(tick: PlayerTick) => void>();
  private loop: Loop = { a: null, b: null };
  private laps = 0;

  /**
   * Instancie le lecteur dans un conteneur. L'API remplace l'élément cible
   * par son iframe : changer d'écran détruit donc le lecteur, et il faut le
   * remonter. Changer d'instrument ou de source, en revanche, ne reconstruit
   * pas le conteneur — la lecture se poursuit sans coupure.
   */
  async mount(container: HTMLElement): Promise<void> {
    await loadApi();
    // On ne défait que l'instance YouTube : les abonnés au ticker sont ceux
    // de la barre de transport, construite avant le montage, et doivent lui
    // survivre. Les effacer ici laisserait une barre définitivement figée.
    this.teardownPlayer();

    const target = document.createElement('div');
    container.replaceChildren(target);

    const w = window as any;
    await new Promise<void>((resolve) => {
      this.player = new w.YT.Player(target, {
        width: '1',
        height: '1',
        // `controls: 0` : le transport natif n'est jamais vu, tout passe par
        // la barre custom.
        playerVars: { rel: 0, controls: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            this.ready = true;
            if (this.pendingVideoId) {
              this.player.cueVideoById(this.pendingVideoId);
              this.pendingVideoId = null;
            }
            resolve();
          },
        },
      });
    });
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Charge une vidéo. `autoplay` enchaîne la lecture sans nouveau geste : on
   * passe de l'enregistrement original à l'accompagnement en plein travail, et
   * s'arrêter à chaque bascule casserait le fil.
   *
   * La position n'est pas reportée d'une source à l'autre : ce sont deux
   * enregistrements différents, un même instant n'y désigne pas le même
   * endroit du morceau.
   */
  load(videoId: string, autoplay = false): void {
    this.clearLoop();
    if (!this.ready || !this.player) {
      this.pendingVideoId = videoId;
      return;
    }
    if (autoplay) this.player.loadVideoById(videoId);
    else this.player.cueVideoById(videoId);
  }

  /** Charge une vidéo sans la démarrer. */
  cue(videoId: string): void {
    this.load(videoId, false);
  }

  play(): void {
    this.player?.playVideo?.();
  }

  pause(): void {
    this.player?.pauseVideo?.();
  }

  isPlaying(): boolean {
    // 1 = YT.PlayerState.PLAYING.
    return this.player?.getPlayerState?.() === 1;
  }

  /**
   * État brut du lecteur : -1 non démarré, 0 terminé, 1 lecture, 2 pause,
   * 3 mise en mémoire tampon, 5 en file. `-1` si le lecteur n'est pas prêt.
   */
  getPlayerState(): number {
    return this.player?.getPlayerState?.() ?? -1;
  }

  togglePlay(): void {
    if (!this.player?.getPlayerState) return;
    if (this.isPlaying()) this.pause();
    else this.play();
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }

  getDuration(): number {
    return this.player?.getDuration?.() ?? 0;
  }

  seekTo(seconds: number): void {
    const duration = this.getDuration();
    const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    this.player?.seekTo?.(target, true);
  }

  // --- Ticker partagé -----------------------------------------------------

  /**
   * S'abonne au sondage de position. Retourne la fonction de désabonnement.
   * L'intervalle ne tourne que tant qu'il reste au moins un abonné.
   */
  onTick(listener: (tick: PlayerTick) => void): () => void {
    this.listeners.add(listener);
    this.startTicker();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopTicker();
    };
  }

  private startTicker(): void {
    if (this.tickId !== null) return;
    this.tickId = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.tickId === null) return;
    window.clearInterval(this.tickId);
    this.tickId = null;
  }

  private tick(): void {
    const currentTime = this.getCurrentTime();
    const { a, b } = this.loop;
    // La boucle est surveillée ici plutôt que dans un second intervalle :
    // un seul sondage sert le transport et le bouclage.
    let wrapped = false;
    if (a !== null && b !== null && b > a && currentTime >= b) {
      this.seekTo(a);
      this.laps += 1;
      wrapped = true;
    }
    const tick: PlayerTick = {
      currentTime,
      duration: this.getDuration(),
      playing: this.isPlaying(),
      loop: this.getLoop(),
      laps: this.laps,
      wrapped,
    };
    for (const listener of this.listeners) listener(tick);
  }

  // --- Boucle A-B ---------------------------------------------------------

  getLoop(): Loop {
    return { ...this.loop };
  }

  /**
   * Pose les deux bornes d'un coup, en secondes. Sert au tracé à la souris,
   * où l'utilisateur désigne un intervalle sans passer par la lecture.
   */
  setLoop(a: number, b: number): Loop {
    const duration = this.getDuration();
    const clamp = (v: number) =>
      Math.max(0, duration ? Math.min(v, duration) : v);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    this.loop = { a: clamp(lo), b: clamp(Math.max(hi, lo + MIN_LOOP)) };
    this.laps = 0;
    this.seekTo(this.loop.a!);
    return this.getLoop();
  }

  /** Pose une borne au temps courant. Poser B lance la boucle aussitôt. */
  markLoopPoint(point: 'a' | 'b'): Loop {
    this.loop = { ...this.loop, [point]: this.getCurrentTime() };
    this.laps = 0;
    // Poser B avant A n'a pas de sens : on remet les bornes dans l'ordre
    // plutôt que d'ignorer le geste.
    const { a, b } = this.loop;
    if (a !== null && b !== null && b < a) this.loop = { a: b, b: a };
    if (point === 'b' && this.loop.a !== null) {
      this.seekTo(this.loop.a);
      this.play();
    }
    return this.getLoop();
  }

  /** Déplace une borne de `delta` secondes (négatif pour reculer). */
  nudgeLoopPoint(point: 'a' | 'b', delta: number): Loop {
    const value = this.loop[point];
    if (value === null) return this.getLoop();
    const duration = this.getDuration();
    let next = Math.max(0, value + delta);
    if (duration) next = Math.min(next, duration);
    this.loop = { ...this.loop, [point]: next };
    const { a, b } = this.loop;
    if (a !== null && b !== null && b - a < MIN_LOOP) {
      // On garde au moins un intervalle jouable plutôt qu'une boucle vide.
      if (point === 'a') this.loop.a = Math.max(0, b - MIN_LOOP);
      else this.loop.b = a + MIN_LOOP;
    }
    return this.getLoop();
  }

  clearLoop(): Loop {
    this.loop = { a: null, b: null };
    this.laps = 0;
    return this.getLoop();
  }

  /**
   * Applique une vitesse de lecture et retourne celle réellement obtenue.
   *
   * YouTube n'accepte que les paliers de `getAvailablePlaybackRates()`
   * (0.25, 0.5, 0.75, 1, 1.25…) : toute autre valeur est ignorée
   * silencieusement. On se rabat donc sur le palier le plus proche et on
   * renvoie la vitesse effective, pour que l'interface n'affiche jamais un
   * réglage que le lecteur n'applique pas.
   */
  setRate(rate: number): number {
    if (!this.player?.setPlaybackRate) return rate;
    const available: number[] =
      this.player.getAvailablePlaybackRates?.() ?? [rate];
    const nearest = available.reduce((best, candidate) =>
      Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best,
    );
    this.player.setPlaybackRate(nearest);
    return nearest;
  }

  getRate(): number {
    return this.player?.getPlaybackRate?.() ?? 1;
  }

  /**
   * Démarrage à froid : saute à un instant aléatoire, laisse trois secondes
   * de préparation, puis lance la lecture. `onTick` reçoit 3, 2, 1 puis 0.
   */
  coldJump(onTick: (remaining: number) => void): void {
    this.clearCountdown();
    const duration = this.getDuration();
    if (!duration) {
      onTick(0);
      return;
    }
    // On évite le tout début et la coda : on veut tomber en plein morceau.
    const target = duration * (0.1 + Math.random() * 0.75);
    this.pause();
    this.player?.seekTo?.(target, true);

    for (let remaining = 3; remaining >= 0; remaining -= 1) {
      const delay = (3 - remaining) * 1000;
      this.countdownTimers.push(
        window.setTimeout(() => {
          onTick(remaining);
          if (remaining === 0) this.play();
        }, delay),
      );
    }
  }

  clearCountdown(): void {
    this.countdownTimers.forEach((id) => window.clearTimeout(id));
    this.countdownTimers = [];
  }

  /** Défait l'instance YouTube, sans toucher aux abonnés du ticker. */
  private teardownPlayer(): void {
    this.clearCountdown();
    this.clearLoop();
    this.player?.destroy?.();
    this.player = null;
    this.ready = false;
  }

  destroy(): void {
    this.teardownPlayer();
    this.stopTicker();
    this.listeners.clear();
  }
}

/** Paliers réellement supportés par le lecteur YouTube. */
export const PLAYBACK_RATES = [0.5, 0.75, 1];

/** `123.4` → `2:03`. Les durées YouTube dépassent rarement l'heure. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
