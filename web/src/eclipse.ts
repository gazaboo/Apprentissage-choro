/** Éclipses : la partition disparaît par surprise, quelques secondes.
 *
 * Là où les mesures cachées travaillent la mémoire locale — *que vient-il
 * ici ?* —, les éclipses travaillent la continuité : privé de la page en plein
 * milieu d'une phrase, on doit continuer plutôt que s'arrêter, et le retour de
 * la partition donne aussitôt le verdict.
 *
 * L'horloge est propre au dispositif et n'avance que lorsqu'on joue
 * réellement : une éclipse qui tomberait pendant qu'on règle la vitesse,
 * l'instrument posé, ne serait qu'une gêne.
 */

import type { EclipseIntensity } from './types';

const TICK_MS = 100;

/** Fourchettes, en secondes : intervalle entre deux éclipses, puis durée. */
const RANGES: Record<EclipseIntensity, { gap: [number, number]; hide: [number, number] }> = {
  douces: { gap: [25, 40], hide: [4, 8] },
  moyennes: { gap: [15, 25], hide: [8, 14] },
  intenses: { gap: [8, 15], hide: [14, 22] },
};

export interface EclipseOptions {
  intensity: EclipseIntensity;
  /** L'horloge n'avance que quand ceci est vrai (typiquement : ça joue). */
  isActive: () => boolean;
  /** La partition vient de disparaître, pour `seconds` secondes. */
  onHide: (seconds: number) => void;
  /** Secondes restantes, à chaque battement pendant l'éclipse. */
  onCountdown: (remaining: number) => void;
  /** La partition est revenue. */
  onShow: () => void;
}

function pick(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

export class EclipseRunner {
  private timerId: number | null = null;
  private intensity: EclipseIntensity;
  private hiding = false;
  /** Secondes restantes avant le prochain changement d'état. */
  private remaining = 0;
  private eclipses = 0;
  private escapes = 0;

  constructor(private readonly options: EclipseOptions) {
    this.intensity = options.intensity;
    this.remaining = pick(RANGES[this.intensity].gap);
  }

  setIntensity(intensity: EclipseIntensity): void {
    this.intensity = intensity;
    // Le nouveau réglage vaut pour la suite ; on ne coupe pas une éclipse en
    // cours, qui deviendrait incompréhensible.
    if (!this.hiding) this.remaining = pick(RANGES[intensity].gap);
  }

  start(): void {
    if (this.timerId !== null) return;
    this.timerId = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timerId !== null) window.clearInterval(this.timerId);
    this.timerId = null;
    if (this.hiding) this.show();
  }

  private tick(): void {
    if (!this.options.isActive()) return;
    this.remaining -= TICK_MS / 1000;

    if (this.hiding) {
      if (this.remaining <= 0) this.show();
      else this.options.onCountdown(Math.ceil(this.remaining));
      return;
    }
    if (this.remaining <= 0) this.hide();
  }

  private hide(): void {
    const seconds = pick(RANGES[this.intensity].hide);
    this.hiding = true;
    this.remaining = seconds;
    this.eclipses += 1;
    this.options.onHide(Math.ceil(seconds));
    this.options.onCountdown(Math.ceil(seconds));
  }

  private show(): void {
    this.hiding = false;
    this.remaining = pick(RANGES[this.intensity].gap);
    this.options.onShow();
  }

  /**
   * Rend la partition avant la fin de l'éclipse. C'est l'équivalent exact de
   * l'indice éphémère des mesures cachées : un aveu qu'on ne s'en sortait pas,
   * et c'est à ce titre qu'il est compté.
   */
  revealNow(): void {
    if (!this.hiding) return;
    this.escapes += 1;
    this.show();
  }

  get isHiding(): boolean {
    return this.hiding;
  }

  /** Nombre d'éclipses survenues depuis le début du passage. */
  get count(): number {
    return this.eclipses;
  }

  /** Nombre d'éclipses interrompues à la demande. */
  get escapeCount(): number {
    return this.escapes;
  }

  reset(): void {
    this.eclipses = 0;
    this.escapes = 0;
    if (this.hiding) this.show();
    else this.remaining = pick(RANGES[this.intensity].gap);
  }
}
