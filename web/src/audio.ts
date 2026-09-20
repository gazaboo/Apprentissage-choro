/** Lecteur audio local, transport et boucle A-B.
 *
 * Remplace l'ancien lecteur YouTube IFrame (#18). Les fichiers Opus sont
 * servis depuis `data/<morceau>/audio/` : même origine, pas de tiers, pas de
 * publicité, et le hors-ligne devient possible.
 *
 * L'élément est rendu hors du champ de vision par le CSS (`.audio-only`)
 * plutôt que retiré du flux : un `<audio>` sans `controls` n'affiche rien,
 * mais le garder rendu évite d'avoir à parier sur le comportement de chaque
 * navigateur.
 */

/** Période du sondage de position : assez fine pour caler une boucle.
 *
 * Lire `currentTime` sur un élément natif est un accès de propriété, là où
 * l'iframe imposait un aller-retour `postMessage` — d'où un sondage deux fois
 * plus serré qu'avant pour une boucle deux fois plus nette.
 */
const TICK_MS = 50;

/** Durée minimale d'une boucle : en deçà, elle n'est plus jouable. */
const MIN_LOOP = 0.5;

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

/** Pourquoi la lecture n'a pas pu démarrer ou se poursuivre. */
export type PlayerFailure = 'fichier' | 'geste';

export class Player {
  private element: HTMLAudioElement | null = null;
  private pendingSource: { src: string; autoplay: boolean; duration?: number } | null =
    null;

  /** Un seul intervalle pour toute l'application (seek bar, temps, boucle). */
  private tickId: number | null = null;
  private listeners = new Set<(tick: PlayerTick) => void>();
  private failureListeners = new Set<(failure: PlayerFailure) => void>();
  private loop: Loop = { a: null, b: null };
  private laps = 0;
  private rate = 1;

  /** Durée annoncée par le manifeste, le temps que les métadonnées chargent. */
  private declaredDuration = 0;

  /**
   * Instancie le lecteur dans un conteneur. Changer d'écran détruit le
   * lecteur, et il faut le remonter ; changer d'instrument ou de source, en
   * revanche, ne reconstruit pas le conteneur — la lecture se poursuit sans
   * coupure.
   *
   * Reste asynchrone bien qu'un `<audio>` soit prêt sur-le-champ : les vues
   * l'attendent, et la signature survivra à un montage qui redeviendrait
   * coûteux.
   */
  async mount(container: HTMLElement): Promise<void> {
    this.teardownPlayer();

    const element = document.createElement('audio');
    // Le fichier fait un à deux Mo et l'utilisateur a explicitement choisi ce
    // morceau : le charger d'emblée évite d'attendre au premier `play()`.
    element.preload = 'auto';
    element.addEventListener('error', () => this.reportFailure('fichier'));
    container.replaceChildren(element);
    this.element = element;

    if (this.pendingSource) {
      const { src, autoplay, duration } = this.pendingSource;
      this.pendingSource = null;
      this.load(src, autoplay, duration);
    }
  }

  get isReady(): boolean {
    return this.element !== null;
  }

  /**
   * Charge un fichier. `autoplay` enchaîne la lecture sans nouveau geste : on
   * passe de l'enregistrement original à l'accompagnement en plein travail, et
   * s'arrêter à chaque bascule casserait le fil.
   *
   * La position n'est pas reportée d'une source à l'autre : ce sont deux
   * enregistrements différents, un même instant n'y désigne pas le même
   * endroit du morceau.
   *
   * `knownDuration` vient du manifeste : la barre de défilement et le libellé
   * « x:xx / y:yy » sont alors justes immédiatement, au lieu d'afficher `0:00`
   * le temps que les métadonnées arrivent.
   */
  load(src: string, autoplay = false, knownDuration?: number): void {
    this.clearLoop();
    if (!this.element) {
      this.pendingSource = { src, autoplay, duration: knownDuration };
      return;
    }
    this.declaredDuration = knownDuration ?? 0;
    this.element.src = src;
    // Une nouvelle source remet la vitesse à 1 : on réapplique le réglage
    // courant, sinon un changement de morceau annulerait le ralenti choisi.
    this.applyRate();
    this.element.load();
    if (autoplay) this.play();
  }

  /** Charge un fichier sans le démarrer. */
  cue(src: string, knownDuration?: number): void {
    this.load(src, false, knownDuration);
  }

  play(): void {
    const started = this.element?.play();
    // `play()` rend une promesse rejetable : sans geste utilisateur récent, le
    // navigateur refuse. L'iframe YouTube héritait de la permission acquise au
    // montage et masquait ce cas ; il faut désormais le dire à l'interface.
    void started?.catch(() => this.reportFailure('geste'));
  }

  pause(): void {
    this.element?.pause();
  }

  isPlaying(): boolean {
    const element = this.element;
    return element !== null && !element.paused && !element.ended;
  }

  /** Vrai quand la lecture a atteint la fin du fichier. */
  hasEnded(): boolean {
    return this.element?.ended ?? false;
  }

  togglePlay(): void {
    if (!this.element) return;
    if (this.isPlaying()) this.pause();
    else this.play();
  }

  getCurrentTime(): number {
    return this.element?.currentTime ?? 0;
  }

  getDuration(): number {
    const measured = this.element?.duration;
    // `duration` vaut `NaN` avant les métadonnées et `Infinity` sur un flux :
    // dans les deux cas la valeur du manifeste est meilleure que rien.
    if (measured !== undefined && Number.isFinite(measured)) return measured;
    return this.declaredDuration;
  }

  seekTo(seconds: number): void {
    if (!this.element) return;
    const duration = this.getDuration();
    this.element.currentTime = Math.max(
      0,
      duration ? Math.min(seconds, duration) : seconds,
    );
  }

  // --- Pannes -------------------------------------------------------------

  /**
   * S'abonne aux pannes de lecture : fichier illisible ou absent, lecture
   * refusée faute de geste utilisateur. Retourne la fonction de désabonnement.
   */
  onFailure(listener: (failure: PlayerFailure) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  private reportFailure(failure: PlayerFailure): void {
    for (const listener of this.failureListeners) listener(failure);
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
   * Un élément natif accepte n'importe quel ratio — l'ancien alignement sur
   * les paliers de YouTube (0,25 / 0,5 / 0,75…) n'a plus lieu d'être. Le
   * retour est conservé parce que l'interface s'en sert pour n'afficher que
   * des vitesses réellement appliquées.
   *
   * `preservesPitch` garde la hauteur : on ralentit sans transposer, ce qui
   * est tout l'intérêt de l'exercice.
   */
  setRate(rate: number): number {
    this.rate = rate;
    this.applyRate();
    return rate;
  }

  private applyRate(): void {
    if (!this.element) return;
    this.element.preservesPitch = true;
    this.element.playbackRate = this.rate;
  }

  getRate(): number {
    return this.element?.playbackRate ?? this.rate;
  }

  /** Défait l'élément audio, sans toucher aux abonnés du ticker.
   *
   * Les abonnés au ticker sont ceux de la barre de transport, construite avant
   * le montage, et doivent lui survivre : les effacer ici laisserait une barre
   * définitivement figée.
   */
  private teardownPlayer(): void {
    this.clearLoop();
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute('src');
      this.element.load();
      this.element.remove();
    }
    this.element = null;
    this.declaredDuration = 0;
  }

  destroy(): void {
    this.teardownPlayer();
    this.stopTicker();
    this.listeners.clear();
    this.failureListeners.clear();
  }
}

/** Vitesses proposées par l'interface.
 *
 * Trois paliers par choix d'ergonomie, non par contrainte : depuis le passage
 * à un lecteur natif, n'importe quelle valeur serait applicable.
 */
export const PLAYBACK_RATES = [0.5, 0.75, 1];

/** `123.4` → `2:03`. Les morceaux dépassent rarement l'heure. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
