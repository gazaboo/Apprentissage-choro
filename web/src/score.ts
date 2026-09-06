/** Partition à trous : calque de masquage en verre dépoli et indice éphémère.
 *
 * Les masques sont des boîtes CSS positionnées en pourcentages, et non des
 * rectangles SVG : `backdrop-filter` ne s'applique qu'aux boîtes CSS. Les
 * mesures du manifeste étant déjà normalisées entre 0 et 1, leurs coordonnées
 * s'écrivent telles quelles en pourcentage et suivent l'image à n'importe
 * quelle taille, sans le moindre recalcul au redimensionnement.
 */

import type { Instrument, MaskLevel, Measure, Page } from './types';

/** Durée exacte de l'indice éphémère, en millisecondes. */
export const HINT_DURATION_MS = 5000;
/** Opacité du masque pendant l'indice : la mesure devient lisible. */
const HINT_OPACITY = '0.12';

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Le motif de masquage doit être stable d'une session à l'autre : on veut
 * réviser les mêmes trous, pas redécouvrir une partition différente à chaque
 * chargement. Le bouton « Mélanger » fait avancer la graine, seule façon
 * d'obtenir un nouveau tirage.
 */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Une mesure, replacée dans le fil de lecture de la partition entière. */
interface Slot {
  pageIndex: number;
  measureIndex: number;
  /** Rang de la mesure dans la partition complète. */
  ordinal: number;
  /** Rang de la mesure dans son système (approximé par sa ligne). */
  indexInRow: number;
  rowLength: number;
  isRowStart: boolean;
  isRowEnd: boolean;
}

/** Regroupe les mesures d'une page par système, d'après leur ordonnée. */
function buildSlots(instrument: Instrument): Slot[] {
  const slots: Slot[] = [];
  let ordinal = 0;

  instrument.pages.forEach((page, pageIndex) => {
    // Deux mesures appartiennent au même système si leurs boîtes se
    // recouvrent verticalement de façon franche.
    const rows: number[][] = [];
    page.measures.forEach((measure, measureIndex) => {
      const { y, h } = measure.box;
      const row = rows.find((candidate) => {
        const first = page.measures[candidate[0]!]!;
        const overlap =
          Math.min(y + h, first.box.y + first.box.h) - Math.max(y, first.box.y);
        return overlap > Math.min(h, first.box.h) * 0.5;
      });
      if (row) row.push(measureIndex);
      else rows.push([measureIndex]);
    });

    for (const row of rows) {
      row.sort((a, b) => page.measures[a]!.box.x - page.measures[b]!.box.x);
      row.forEach((measureIndex, indexInRow) => {
        slots.push({
          pageIndex,
          measureIndex,
          ordinal: ordinal++,
          indexInRow,
          rowLength: row.length,
          isRowStart: indexInRow === 0,
          isRowEnd: indexInRow === row.length - 1,
        });
      });
    }
  });

  return slots;
}

/**
 * Tire au sort les mesures à masquer pour un taux donné.
 *
 * Le tirage est aléatoire, à une réserve près : les débuts de système sont
 * servis en dernier. Ce sont les *performance cues*, les points de reprise
 * auxquels on se raccroche quand la mémoire lâche ; les épargner tant que le
 * taux le permet est ce qui distingue une partition à trous d'une page noire.
 */
function selectMasked(slots: Slot[], level: number, seed: string): Set<number> {
  if (level <= 0) return new Set();
  const random = seededRandom(seed);

  const ranked = slots
    .map((slot) => ({
      ordinal: slot.ordinal,
      rank: slot.isRowStart ? 0 : 1,
      jitter: random(),
    }))
    .sort((a, b) => b.rank - a.rank || a.jitter - b.jitter);

  const target = Math.round((slots.length * level) / 100);
  return new Set(ranked.slice(0, target).map((entry) => entry.ordinal));
}

export interface ScoreOptions {
  onHintUsed: () => void;
}

/** Rend une partition et pilote son masquage. */
export class ScoreView {
  private slots: Slot[] = [];
  private masked = new Set<number>();
  /** Boîtes de masquage indexées par ordinal de mesure. */
  private boxes = new Map<number, HTMLElement>();
  private hintTimers = new Map<number, number>();
  private hintCursor = 0;
  private level: MaskLevel = 50;
  private seed = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly options: ScoreOptions,
  ) {}

  /** (Re)construit l'affichage pour une partition donnée. */
  render(instrument: Instrument, seed: string, level: MaskLevel): void {
    this.clearHints();
    this.slots = buildSlots(instrument);
    this.seed = seed;
    this.level = level;
    this.masked = selectMasked(this.slots, this.rate, seed);
    this.boxes.clear();
    this.container.replaceChildren();

    // « Sans partition » : rien n'est rendu du tout. Ce n'est pas un masquage
    // à 100 % — il ne reste aucune page à regarder, donc aucune tentation.
    if (level === 'aucune') return;

    instrument.pages.forEach((page, pageIndex) => {
      this.container.appendChild(this.renderPage(page, pageIndex));
    });
  }

  /** Taux effectif ; « sans partition » vaut 100 % de mesures dérobées. */
  private get rate(): number {
    return this.level === 'aucune' ? 100 : this.level;
  }

  private renderPage(page: Page, pageIndex: number): HTMLElement {
    const wrapper = document.createElement('figure');
    wrapper.className =
      'relative m-0 overflow-hidden rounded-lg bg-white shadow-lg shadow-black/40';

    const img = document.createElement('img');
    img.src = page.image_path;
    img.alt = `Page ${page.page_number}`;
    img.loading = pageIndex === 0 ? 'eager' : 'lazy';
    img.className = 'block w-full select-none';
    img.draggable = false;
    wrapper.appendChild(img);

    const layer = document.createElement('div');
    layer.className = 'pointer-events-none absolute inset-0';

    page.measures.forEach((measure, measureIndex) => {
      const slot = this.slots.find(
        (candidate) =>
          candidate.pageIndex === pageIndex &&
          candidate.measureIndex === measureIndex,
      );
      if (!slot) return;
      // Un masque n'est créé que pour une mesure effectivement masquée : au
      // palier « Aucun », le calque est vide et ne laisse aucun résidu.
      if (!this.masked.has(slot.ordinal)) return;
      layer.appendChild(this.renderMask(measure, slot));
    });

    wrapper.appendChild(layer);
    return wrapper;
  }

  private renderMask(measure: Measure, slot: Slot): HTMLElement {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'measure-mask';
    box.style.left = `${measure.box.x * 100}%`;
    box.style.top = `${measure.box.y * 100}%`;
    box.style.width = `${measure.box.w * 100}%`;
    box.style.height = `${measure.box.h * 100}%`;
    box.dataset.ordinal = String(slot.ordinal);
    box.setAttribute('aria-label', 'Révéler cette mesure quelques secondes');
    box.addEventListener('click', () => this.revealTemporarily(slot.ordinal));

    this.boxes.set(slot.ordinal, box);
    return box;
  }

  /**
   * Change de palier. Le DOM des pages n'est reconstruit que si l'on entre ou
   * sort de « sans partition » ; sinon seuls les masques sont redessinés, ce
   * qui garde la position de défilement et la transition douce.
   */
  setLevel(level: MaskLevel, instrument: Instrument): void {
    const wasHidden = this.level === 'aucune';
    this.level = level;
    if (wasHidden || level === 'aucune') {
      this.render(instrument, this.seed, level);
      return;
    }
    this.masked = selectMasked(this.slots, this.rate, this.seed);
    this.repaintMasks(instrument);
  }

  /** Nouveau tirage sur la même partition, sans rechargement. */
  reshuffle(seed: string, instrument: Instrument): void {
    this.seed = seed;
    this.masked = selectMasked(this.slots, this.rate, seed);
    if (this.level === 'aucune') return;
    this.repaintMasks(instrument);
  }

  /**
   * Redessine le calque de masquage seul. Les images restent en place : elles
   * ne sont pas rechargées, et l'on ne voit qu'un fondu des masques.
   */
  private repaintMasks(instrument: Instrument): void {
    this.clearHints();
    this.boxes.clear();
    const figures = [...this.container.children];
    instrument.pages.forEach((page, pageIndex) => {
      const figure = figures[pageIndex];
      if (!(figure instanceof HTMLElement)) return;
      const layer = figure.lastElementChild;
      if (!(layer instanceof HTMLElement)) return;
      const next: HTMLElement[] = [];
      page.measures.forEach((measure, measureIndex) => {
        const slot = this.slots.find(
          (candidate) =>
            candidate.pageIndex === pageIndex &&
            candidate.measureIndex === measureIndex,
        );
        if (!slot || !this.masked.has(slot.ordinal)) return;
        next.push(this.renderMask(measure, slot));
      });
      layer.replaceChildren(...next);
    });
  }

  get maskLevel(): MaskLevel {
    return this.level;
  }

  /**
   * Nombre de mesures dérobées à la lecture. Sans partition, ce sont toutes
   * les mesures : le questionnaire d'auto-évaluation en tient compte pour
   * suggérer la note.
   */
  get maskedCount(): number {
    return this.level === 'aucune' ? this.slots.length : this.masked.size;
  }

  /**
   * Indice éphémère : la mesure s'éclaircit quelques secondes puis se
   * re-masque seule. Le retour automatique est le cœur du dispositif — il
   * empêche de transformer l'indice en lecture passive.
   */
  revealTemporarily(ordinal: number): void {
    const box = this.boxes.get(ordinal);
    if (!box || !this.masked.has(ordinal)) return;

    const existing = this.hintTimers.get(ordinal);
    if (existing !== undefined) window.clearTimeout(existing);
    else this.options.onHintUsed(); // on ne compte pas un indice re-déclenché

    box.style.opacity = HINT_OPACITY;
    this.hintTimers.set(
      ordinal,
      window.setTimeout(() => {
        box.style.opacity = '';
        this.hintTimers.delete(ordinal);
      }, HINT_DURATION_MS),
    );
  }

  /** Révèle la mesure masquée suivante, en suivant le fil de lecture. */
  revealNext(): void {
    const maskedOrdinals = this.slots
      .map((slot) => slot.ordinal)
      .filter((ordinal) => this.masked.has(ordinal));
    if (maskedOrdinals.length === 0) return;

    this.hintCursor %= maskedOrdinals.length;
    const ordinal = maskedOrdinals[this.hintCursor]!;
    this.hintCursor += 1;
    this.revealTemporarily(ordinal);
  }

  /** Remet le curseur d'indice au début (nouveau passage sur le morceau). */
  resetHintCursor(): void {
    this.hintCursor = 0;
  }

  private clearHints(): void {
    for (const timer of this.hintTimers.values()) window.clearTimeout(timer);
    this.hintTimers.clear();
  }

  destroy(): void {
    this.clearHints();
    this.container.replaceChildren();
  }
}
