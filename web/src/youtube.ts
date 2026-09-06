/** Lecteur YouTube et contrôles cognitifs (saut à froid, ghost mode).
 *
 * L'API IFrame ne se charge qu'une fois pour toute la session ; changer de
 * source ou de morceau réutilise le même lecteur via `loadVideoById`, ce qui
 * évite le clignotement d'un remontage d'iframe.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type YTPlayer = any;

const API_SRC = 'https://www.youtube.com/iframe_api';

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

export class Player {
  private player: YTPlayer | null = null;
  private ready = false;
  private pendingVideoId: string | null = null;
  private countdownTimers: number[] = [];

  /**
   * Instancie le lecteur dans un conteneur. L'API remplace l'élément cible
   * par son iframe : changer d'écran détruit donc le lecteur, et il faut le
   * remonter. Changer d'instrument ou de source, en revanche, ne reconstruit
   * pas le conteneur — la lecture se poursuit sans coupure.
   */
  async mount(container: HTMLElement): Promise<void> {
    await loadApi();
    this.destroy();

    const target = document.createElement('div');
    container.replaceChildren(target);

    const w = window as any;
    await new Promise<void>((resolve) => {
      this.player = new w.YT.Player(target, {
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, controls: 1, modestbranding: 1, playsinline: 1 },
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

  /** Charge une vidéo sans la démarrer. */
  cue(videoId: string): void {
    if (!this.ready || !this.player) {
      this.pendingVideoId = videoId;
      return;
    }
    this.player.cueVideoById(videoId);
  }

  play(): void {
    this.player?.playVideo?.();
  }

  pause(): void {
    this.player?.pauseVideo?.();
  }

  togglePlay(): void {
    if (!this.player?.getPlayerState) return;
    // 1 = en lecture (constante YT.PlayerState.PLAYING).
    if (this.player.getPlayerState() === 1) this.pause();
    else this.play();
  }

  getDuration(): number {
    return this.player?.getDuration?.() ?? 0;
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

  destroy(): void {
    this.clearCountdown();
    this.player?.destroy?.();
    this.player = null;
    this.ready = false;
  }
}

/** Paliers réellement supportés par le lecteur YouTube. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25];
