/** Grille d'accords à trous : même dispositif que la partition à trous, mais
 * sur une carte de papier où chaque cellule porte les accords d'une mesure.
 *
 * L'interface publique reproduit celle de `ScoreView` (`render`, `setLevel`,
 * `reshuffle`, `revealTemporarily`, `destroy`, getters `maskLevel` /
 * `measureCount` / `maskedCount`) pour que l'écran d'entraînement route ses
 * appels vers l'une ou l'autre vue sans cas particulier.
 *
 * Le masque est un calque en verre dépoli posé en recouvrement de la cellule
 * (`.chord-mask`, `position: absolute; inset: 0`), et non une boîte placée en
 * pourcentage comme sur l'image de partition.
 */

import { el } from './dom';
import { seededRandom } from './random';
import { HINT_DURATION_MS } from './score';
import type { Grille, GrilleCell, GrillePart, Instrument } from './types';

/** Opacité du masque pendant l'indice : l'accord redevient lisible. */
const HINT_OPACITY = '0.12';

/** Nombre de mesures par ligne de grille. */
const BARS_PER_LINE = 4;

/** Une cellule masquable, replacée dans le fil de lecture de la grille. */
interface Slot {
  /** Rang de la cellule parmi les cellules masquables, dans l'ordre de jeu. */
  ordinal: number;
  /** Première cellule d'une partie. */
  isPartStart: boolean;
  /** Première cellule d'une ligne de quatre mesures. */
  isLineStart: boolean;
}

export interface GrilleOptions {
  onHintUsed: () => void;
}

/**
 * Tire au sort les cellules à masquer pour un taux donné.
 *
 * Comme pour la partition (`score.ts`), les repères de reprise — débuts de
 * partie et de ligne — sont servis en dernier : ce sont eux qu'on regarde
 * quand la mémoire lâche.
 */
function selectMasked(slots: Slot[], level: number, seed: string): Set<number> {
  if (level <= 0 || slots.length === 0) return new Set();
  const random = seededRandom(seed);

  const ranked = slots
    .map((slot) => ({
      ordinal: slot.ordinal,
      rank: slot.isLineStart || slot.isPartStart ? 0 : 1,
      jitter: random(),
    }))
    .sort((a, b) => b.rank - a.rank || a.jitter - b.jitter);

  const target = Math.round((slots.length * level) / 100);
  return new Set(ranked.slice(0, target).map((entry) => entry.ordinal));
}

/** Rang global (0-based) de chaque cellule masquable d'une grille. */
function buildSlots(grille: Grille): Slot[] {
  const slots: Slot[] = [];
  let ordinal = 0;
  for (const part of grille.parts) {
    let firstInPart = true;
    part.sequence.forEach((cell, index) => {
      if (cell.length === 0) return; // « on tient » : rien à masquer
      slots.push({
        ordinal: ordinal++,
        isPartStart: firstInPart,
        isLineStart: index % BARS_PER_LINE === 0,
      });
      firstInPart = false;
    });
  }
  return slots;
}

/** Numéro de la première mesure d'une ligne, d'après `part.bars`. */
function barLabel(part: GrillePart, offset: number): string {
  const match = part.bars?.match(/\d+/);
  if (!match || match[0] === undefined) return '';
  return String(parseInt(match[0], 10) + offset);
}

/** Rend une grille d'accords et pilote son masquage. */
export class GrilleView {
  private grille: Grille | null = null;
  private slots: Slot[] = [];
  private masked = new Set<number>();
  /** Élément `.chord-cell` de chaque cellule masquable, par ordinal. */
  private cells = new Map<number, HTMLElement>();
  /** Bouton masque en place, par ordinal. */
  private masks = new Map<number, HTMLButtonElement>();
  private hintTimers = new Map<number, number>();
  private level = 0;
  private seed = '';
  /** Mention « accords en Ut » : posée quand l'instrument n'est pas en Ut. */
  private keyNote = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: GrilleOptions,
  ) {}

  /** Pose les données, une fois le fichier `data/grilles/<id>.json` chargé. */
  setGrille(grille: Grille | null): void {
    this.grille = grille;
  }

  /** (Re)construit l'affichage pour la grille posée. */
  render(instrument: Instrument, seed: string, level: number): void {
    this.clearHints();
    this.seed = seed;
    this.level = level;
    this.keyNote = instrument.id !== 'c';
    this.cells.clear();
    this.masks.clear();

    if (!this.grille) {
      this.slots = [];
      this.masked = new Set();
      this.container.replaceChildren();
      return;
    }

    this.slots = buildSlots(this.grille);
    this.masked = selectMasked(this.slots, level, seed);

    const surface = el('div', { class: 'grille-surface' });
    if (this.keyNote) {
      surface.appendChild(
        el('p', { class: 'grille-key-note' }, 'Accords en Ut (concert)'),
      );
    }

    const parts = el('div', { class: 'grille-parts' });
    let ordinal = 0;
    for (const part of this.grille.parts) {
      ordinal = this.renderPart(parts, part, ordinal);
    }
    if (this.grille.coda && this.grille.coda.length > 0) {
      const grid = el('div', { class: 'grille-grid' });
      pushLabeledRow(grid, 'Coda', this.grille.coda);
      parts.appendChild(el('section', { class: 'grille-part' }, grid));
    }
    surface.appendChild(parts);

    const remarks = [
      ...(this.grille.coda_note ? [this.grille.coda_note] : []),
      ...(this.grille.notes ?? []),
    ];
    if (remarks.length > 0) {
      surface.appendChild(
        el(
          'details',
          { class: 'grille-notes' },
          el('summary', {}, `À vérifier (${remarks.length})`),
          el('ul', {}, ...remarks.map((note) => el('li', {}, note))),
        ),
      );
    }

    this.container.replaceChildren(surface);
  }

  private renderPart(
    parent: HTMLElement,
    part: GrillePart,
    startOrdinal: number,
  ): number {
    const meta = [
      part.tonic ? `centre : ${part.tonic}` : null,
      part.bars ? `mes. ${part.bars}` : null,
      part.repeat ? 'reprise' : null,
    ].filter((entry): entry is string => entry !== null);

    const section = el(
      'section',
      { class: 'grille-part' },
      el(
        'div',
        { class: 'grille-part-head' },
        el('h3', {}, part.name),
        meta.length > 0
          ? el('p', { class: 'grille-part-meta' }, ...joinDots(meta))
          : null,
      ),
    );

    const grid = el('div', { class: 'grille-grid' });

    if (part.transition_in && part.transition_in.length > 0) {
      pushLabeledRow(grid, 'transition', part.transition_in);
    }

    let ordinal = startOrdinal;
    for (let i = 0; i < part.sequence.length; i += BARS_PER_LINE) {
      const slice = part.sequence.slice(i, i + BARS_PER_LINE);
      grid.appendChild(el('span', { class: 'grille-barno' }, barLabel(part, i)));
      slice.forEach((cell) => {
        grid.appendChild(this.measureCell(cell, ordinal));
        if (cell.length > 0) ordinal += 1;
      });
      padLine(grid, slice.length);
    }

    if (part.endings?.['1']) pushEnding(grid, '1.', part.endings['1']);
    if (part.endings?.['2']) pushEnding(grid, '2.', part.endings['2']);
    if (part.coda && part.coda.length > 0) pushLabeledRow(grid, 'coda', part.coda);

    section.appendChild(grid);
    parent.appendChild(section);
    return ordinal;
  }

  /** Cellule d'une mesure de la séquence : masquable si elle porte un accord. */
  private measureCell(chords: GrilleCell, ordinal: number): HTMLElement {
    if (chords.length === 0) return simileCell();
    const cellEl = chordCell(chords);
    this.cells.set(ordinal, cellEl);
    if (this.masked.has(ordinal)) this.attachMask(ordinal, cellEl);
    return cellEl;
  }

  private attachMask(ordinal: number, cellEl: HTMLElement): void {
    const mask = el('button', {
      type: 'button',
      class: 'chord-mask',
      'aria-label': 'Révéler cet accord quelques secondes',
    });
    mask.dataset.ordinal = String(ordinal);
    mask.addEventListener('click', () => this.revealTemporarily(ordinal));
    cellEl.appendChild(mask);
    this.masks.set(ordinal, mask);
  }

  /** Change de taux sans redessiner la grille : seuls les masques bougent. */
  setLevel(level: number, instrument: Instrument): void {
    this.level = level;
    this.keyNote = instrument.id !== 'c';
    this.masked = selectMasked(this.slots, level, this.seed);
    this.repaintMasks();
  }

  /** Nouveau tirage sur la même grille. */
  reshuffle(seed: string, instrument: Instrument): void {
    this.seed = seed;
    this.keyNote = instrument.id !== 'c';
    this.masked = selectMasked(this.slots, this.level, seed);
    this.repaintMasks();
  }

  private repaintMasks(): void {
    this.clearHints();
    for (const [ordinal, cellEl] of this.cells) {
      const present = this.masks.has(ordinal);
      const wanted = this.masked.has(ordinal);
      if (wanted && !present) {
        this.attachMask(ordinal, cellEl);
      } else if (!wanted && present) {
        this.masks.get(ordinal)?.remove();
        this.masks.delete(ordinal);
      }
    }
  }

  get maskLevel(): number {
    return this.level;
  }

  /** Nombre de mesures écrites de la grille (toutes cellules, « tenues » comprises). */
  get measureCount(): number {
    if (!this.grille) return 0;
    return this.grille.parts.reduce((total, part) => total + part.sequence.length, 0);
  }

  /** Nombre d'accords dérobés à la lecture. */
  get maskedCount(): number {
    return this.masked.size;
  }

  /**
   * Indice éphémère : l'accord réapparaît quelques secondes puis se re-masque
   * seul. Le retour automatique empêche de transformer l'indice en lecture.
   */
  revealTemporarily(ordinal: number): void {
    const mask = this.masks.get(ordinal);
    if (!mask || !this.masked.has(ordinal)) return;

    const existing = this.hintTimers.get(ordinal);
    if (existing !== undefined) window.clearTimeout(existing);
    else this.options.onHintUsed(); // on ne compte pas un indice re-déclenché

    mask.style.opacity = HINT_OPACITY;
    this.hintTimers.set(
      ordinal,
      window.setTimeout(() => {
        mask.style.opacity = '';
        this.hintTimers.delete(ordinal);
      }, HINT_DURATION_MS),
    );
  }

  private clearHints(): void {
    for (const timer of this.hintTimers.values()) window.clearTimeout(timer);
    this.hintTimers.clear();
  }

  destroy(): void {
    this.clearHints();
    this.cells.clear();
    this.masks.clear();
    this.container.replaceChildren();
  }
}

/** Une cellule d'accords : `['A7']` ou `['A7', 'D7']` (mesure partagée). */
function chordCell(chords: string[], variant?: 'ending'): HTMLElement {
  const nodes: Node[] = [];
  chords.forEach((chord, index) => {
    if (index > 0) nodes.push(el('span', { class: 'sep' }));
    nodes.push(el('span', { class: 'ch' }, chord));
  });
  const cls =
    'chord-cell' +
    (chords.length === 2 ? ' multi' : chords.length > 2 ? ' multi multi-3' : '') +
    (variant === 'ending' ? ' chord-cell--ending' : '');
  return el('div', { class: cls }, ...nodes);
}

/** Cellule « on tient » : le signe de répétition de mesure (%). */
function simileCell(variant?: 'ending'): HTMLElement {
  const cls = 'chord-cell simile' + (variant === 'ending' ? ' chord-cell--ending' : '');
  return el('div', { class: cls }, el('span', { class: 'ch' }, '%'));
}

/** Ajoute des cellules vides jusqu'à compléter une ligne de quatre mesures. */
function padLine(grid: HTMLElement, filled: number): void {
  for (let pad = filled; pad < BARS_PER_LINE; pad += 1) {
    grid.appendChild(el('div', { class: 'chord-cell pad' }));
  }
}

/** Rangée de fin (1re / 2e) : un crochet numéroté au-dessus des mesures. */
function pushEnding(grid: HTMLElement, tag: string, seq: GrilleCell[]): void {
  for (let i = 0; i < seq.length; i += BARS_PER_LINE) {
    const slice = seq.slice(i, i + BARS_PER_LINE);
    grid.appendChild(
      el('span', { class: 'grille-barno grille-end-tag' }, i === 0 ? tag : ''),
    );
    slice.forEach((cell) =>
      grid.appendChild(cell.length === 0 ? simileCell('ending') : chordCell(cell, 'ending')),
    );
    padLine(grid, slice.length);
  }
}

/** Rangée annexe (coda, transition) : un libellé pleine largeur puis les mesures. */
function pushLabeledRow(grid: HTMLElement, label: string, seq: GrilleCell[]): void {
  grid.appendChild(el('div', { class: 'grille-row-label' }, label));
  for (let i = 0; i < seq.length; i += BARS_PER_LINE) {
    const slice = seq.slice(i, i + BARS_PER_LINE);
    grid.appendChild(el('span', { class: 'grille-barno' }, ''));
    slice.forEach((cell) =>
      grid.appendChild(cell.length === 0 ? simileCell() : chordCell(cell)),
    );
    padLine(grid, slice.length);
  }
}

/** Intercale des points de séparation entre des fragments de texte. */
function joinDots(items: string[]): Node[] {
  const nodes: Node[] = [];
  items.forEach((item, index) => {
    if (index > 0) nodes.push(el('span', { class: 'dot' }, '·'));
    nodes.push(document.createTextNode(item));
  });
  return nodes;
}
