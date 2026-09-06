/** Partition à trous : calque SVG de masquage et indice éphémère.
 *
 * Le SVG est dessiné en `viewBox="0 0 1 1"` : les boîtes du manifeste étant
 * déjà normalisées, elles s'y écrivent telles quelles et suivent l'image à
 * n'importe quelle taille, sans le moindre recalcul au redimensionnement.
 */

import type { Instrument, MaskLevel, Measure, Page } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Durée exacte de l'indice éphémère, en millisecondes. */
export const HINT_DURATION_MS = 2000;
const HINT_OPACITY = '0.15';

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * Le motif de masquage doit être stable d'une session à l'autre : on veut
 * réviser les mêmes trous, pas redécouvrir une partition différente à chaque
 * chargement.
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
 * Choisit les mesures à masquer selon le niveau de difficulté.
 *
 * Les trois paliers ne sont pas qu'une question de quantité : ils ciblent des
 * objets cognitifs différents.
 */
function selectMasked(slots: Slot[], level: MaskLevel, seed: string): Set<number> {
  const random = seededRandom(`${seed}|${level}`);

  /** Plus la priorité est haute, plus la mesure mérite d'être masquée. */
  const priority = (slot: Slot): number => {
    if (level === 25) {
      // Cadences et fins de phrases : la résolution harmonique d'abord.
      if (slot.isRowEnd) return 3;
      if (slot.rowLength > 3 && slot.indexInRow === slot.rowLength - 2) return 2;
      return 0;
    }
    if (level === 50) {
      // Damier : une mesure sur deux, pour alterner lecture et rappel.
      return slot.indexInRow % 2 === 1 ? 2 : 0;
    }
    // 80 % : ne subsistent que les repères cardinaux (*performance cues*) —
    // début de système et jalons réguliers.
    const isCue = slot.isRowStart || slot.ordinal % 8 === 0;
    return isCue ? 0 : 2;
  };

  // On trie par priorité puis par un tirage déterministe, et on coupe au
  // nombre voulu : le taux affiché est ainsi tenu exactement, tout en
  // masquant en premier les mesures qui comptent pour ce palier.
  const ranked = slots
    .map((slot) => ({ slot, rank: priority(slot), jitter: random() }))
    .sort((a, b) => b.rank - a.rank || a.jitter - b.jitter);

  const target = Math.round((slots.length * level) / 100);
  return new Set(ranked.slice(0, target).map((entry) => entry.slot.ordinal));
}

export interface ScoreOptions {
  /** Couleur opaque des masques : celle du fond, pour un trou franc. */
  maskColor: string;
  onHintUsed: () => void;
}

/** Rend une partition et pilote son masquage. */
export class ScoreView {
  private slots: Slot[] = [];
  private masked = new Set<number>();
  /** Rectangles SVG indexés par ordinal de mesure. */
  private rects = new Map<number, SVGRectElement>();
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
    this.masked = selectMasked(this.slots, level, seed);
    this.rects.clear();
    this.container.replaceChildren();

    instrument.pages.forEach((page, pageIndex) => {
      this.container.appendChild(this.renderPage(page, pageIndex));
    });
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

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('absolute', 'inset-0', 'h-full', 'w-full');

    page.measures.forEach((measure, measureIndex) => {
      const slot = this.slots.find(
        (candidate) =>
          candidate.pageIndex === pageIndex &&
          candidate.measureIndex === measureIndex,
      );
      if (!slot) return;
      svg.appendChild(this.renderMask(measure, slot));
    });

    wrapper.appendChild(svg);
    return wrapper;
  }

  private renderMask(measure: Measure, slot: Slot): SVGRectElement {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(measure.box.x));
    rect.setAttribute('y', String(measure.box.y));
    rect.setAttribute('width', String(measure.box.w));
    rect.setAttribute('height', String(measure.box.h));
    rect.setAttribute('fill', this.options.maskColor);
    rect.dataset.ordinal = String(slot.ordinal);

    const isMasked = this.masked.has(slot.ordinal);
    rect.style.opacity = isMasked ? '1' : '0';
    rect.style.pointerEvents = isMasked ? 'auto' : 'none';
    rect.style.cursor = isMasked ? 'pointer' : 'default';
    rect.style.transition = 'opacity 120ms ease';
    rect.addEventListener('click', () => this.revealTemporarily(slot.ordinal));

    this.rects.set(slot.ordinal, rect);
    return rect;
  }

  setLevel(level: MaskLevel): void {
    this.level = level;
    this.masked = selectMasked(this.slots, level, this.seed);
    this.clearHints();
    for (const [ordinal, rect] of this.rects) {
      const isMasked = this.masked.has(ordinal);
      rect.style.opacity = isMasked ? '1' : '0';
      rect.style.pointerEvents = isMasked ? 'auto' : 'none';
      rect.style.cursor = isMasked ? 'pointer' : 'default';
    }
  }

  get maskLevel(): MaskLevel {
    return this.level;
  }

  get maskedCount(): number {
    return this.masked.size;
  }

  /**
   * Indice éphémère : la mesure s'éclaircit exactement deux secondes puis se
   * re-masque seule. Le retour automatique est le cœur du dispositif — il
   * empêche de transformer l'indice en lecture passive.
   */
  revealTemporarily(ordinal: number): void {
    const rect = this.rects.get(ordinal);
    if (!rect || !this.masked.has(ordinal)) return;

    const existing = this.hintTimers.get(ordinal);
    if (existing !== undefined) window.clearTimeout(existing);
    else this.options.onHintUsed(); // on ne compte pas un indice re-déclenché

    rect.style.opacity = HINT_OPACITY;
    this.hintTimers.set(
      ordinal,
      window.setTimeout(() => {
        rect.style.opacity = '1';
        this.hintTimers.delete(ordinal);
      }, HINT_DURATION_MS),
    );
  }

  /**
   * Révèle la mesure masquée suivante (raccourci `H`).
   *
   * Un curseur avance d'un trou à chaque appel, en suivant le fil de lecture :
   * l'instrumentiste qui joue la pièce d'un bout à l'autre retrouve l'indice
   * là où il en est, plutôt que de rouvrir toujours le premier trou.
   */
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
