import type { Page } from '@playwright/test';

/**
 * Fabrique un `window.YT.Player` minimal côté navigateur, injecté avant le
 * premier chargement de page. `web/src/youtube.ts` (`loadApi()`) saute déjà
 * le script `iframe_api` quand `window.__YT_STUB__` est vrai (seam posé en
 * Phase 1, issue #17) — il ne reste qu'à fournir la classe `YT.Player` que
 * `Player.mount()` instancie ensuite avec `new w.YT.Player(target, options)`.
 *
 * Surface reproduite (cf. web/src/youtube.ts) : constructeur avec
 * `events.onReady`, `cueVideoById`/`loadVideoById`, `playVideo`/`pauseVideo`,
 * `getPlayerState`, `getCurrentTime`/`getDuration`, `seekTo`,
 * `setPlaybackRate`/`getAvailablePlaybackRates`, `destroy`. Le temps n'avance
 * pas tout seul (pas de lecture audio réelle) — suffisant pour les parcours
 * qui n'ont pas besoin de faire progresser une position de lecture.
 */
function ytStubScript(): void {
  const w = window as unknown as {
    __YT_STUB__: boolean;
    YT: { Player: unknown; PlayerState: Record<string, number> };
  };
  w.__YT_STUB__ = true;
  w.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: class StubPlayer {
      private state = -1;
      private currentTime = 0;
      private duration = 30;
      private rate = 1;
      private onReady: (() => void) | undefined;

      constructor(_target: unknown, options: { events?: { onReady?: () => void } }) {
        this.onReady = options.events?.onReady;
        // Le vrai lecteur devient prêt de façon asynchrone : reproduire ce
        // délai évite qu'un test s'appuie par accident sur une résolution
        // synchrone qui ne se produit jamais en vrai.
        setTimeout(() => this.onReady?.(), 0);
      }

      cueVideoById(): void {
        this.state = 5;
      }

      loadVideoById(): void {
        this.state = 1;
      }

      playVideo(): void {
        this.state = 1;
      }

      pauseVideo(): void {
        this.state = 2;
      }

      getPlayerState(): number {
        return this.state;
      }

      getCurrentTime(): number {
        return this.currentTime;
      }

      getDuration(): number {
        return this.duration;
      }

      seekTo(seconds: number): void {
        this.currentTime = seconds;
      }

      getAvailablePlaybackRates(): number[] {
        return [0.5, 0.75, 1, 1.25, 1.5];
      }

      setPlaybackRate(rate: number): void {
        this.rate = rate;
      }

      getPlaybackRate(): number {
        return this.rate;
      }

      destroy(): void {
        this.state = -1;
      }
    },
  };
}

/** À appeler avant tout `page.goto` : pose le stub avant le premier script de l'app. */
export async function stubYouTube(page: Page): Promise<void> {
  await page.addInitScript(ytStubScript);
  // Garde-fou réseau : si le seam de `youtube.ts` régresse (le script
  // `iframe_api` se charge malgré `__YT_STUB__`), échouer bruyamment plutôt
  // que de laisser un test dépendre silencieusement du vrai YouTube.
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
}
