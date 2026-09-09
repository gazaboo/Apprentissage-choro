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

/* --- Simplification des chiffrages -------------------------------------- */

/**
 * Ramène un chiffrage à sa forme jouable de base : `Xm`, `X` ou `X7`.
 *
 * La grille sert à accompagner, pas à relever : `A7/C#` et `A7/E` demandent le
 * même accord de la main gauche, et les renversements ne font que charger la
 * lecture. On retire donc la basse, et l'on replie les enrichissements sur leur
 * famille — `Gm6`, `Gm7` et `Gm(maj7)` deviennent `Gm`, `D6` devient `D`,
 * `F7#5` devient `F7`.
 *
 * **Deux qualités survivent** : `dim` et `m7b5`. Leur quinte est diminuée, et
 * la remplacer par une quinte juste s'entend — les accords diminués de passage
 * sont une signature du choro, non un ornement qu'on peut lisser.
 *
 * Tout chiffrage non reconnu est rendu tel quel : mieux vaut afficher un accord
 * inhabituel que d'en inventer un faux.
 */
export function simplifyChord(symbol: string): string {
  const match = /^([A-G](?:#|b)?)\s*(.*)$/.exec(symbol.trim());
  if (!match) return symbol;

  const root = match[1] ?? '';
  const withBass = match[2] ?? '';
  // La basse d'un renversement s'écrit après une barre oblique.
  const slash = withBass.indexOf('/');
  const quality = (slash >= 0 ? withBass.slice(0, slash) : withBass).trim();

  // « C dim » se rencontre dans les données à côté de « Cdim » : même accord.
  if (/^dim/i.test(quality) || quality === '°') return `${root}dim`;
  if (/^m(?:in)?7b5$/i.test(quality) || quality === 'ø') return `${root}m7b5`;
  // `maj7` est un accord majeur ; seul un `m` initial marque le mineur.
  if (/^m/i.test(quality) && !/^maj/i.test(quality)) return `${root}m`;
  if (/^(?:7|9|11|13)/.test(quality)) return `${root}7`;
  // Reste le majeur et tout ce qui s'y ramène : `6`, `maj7`, `add9`, `(#5)`.
  return root;
}

/** Simplifie une mesure, puis retire les accords devenus identiques à la file. */
function simplifyCell(cell: GrilleCell): GrilleCell {
  const out: string[] = [];
  for (const chord of cell) {
    const simple = simplifyChord(chord);
    // `Cm/Eb | Cm/G` devient un seul `Cm` : la mesure n'est plus partagée.
    if (out[out.length - 1] !== simple) out.push(simple);
  }
  return out;
}

function simplifyCells(cells: GrilleCell[] | undefined): GrilleCell[] | undefined {
  return cells?.map(simplifyCell);
}

/**
 * Applique la simplification à toute la grille, une fois pour toutes.
 *
 * C'est fait à l'entrée plutôt qu'au rendu : le masquage, l'affichage et la
 * détection des fins de partie repartent tous des mêmes cellules, et les
 * simplifier en un seul point interdit qu'ils se désynchronisent.
 */
export function simplifyGrille(grille: Grille): Grille {
  return {
    ...grille,
    parts: grille.parts.map((part) => ({
      ...part,
      sequence: part.sequence.map(simplifyCell),
      endings: part.endings && {
        ...(part.endings['1'] && { '1': part.endings['1'].map(simplifyCell) }),
        ...(part.endings['2'] && { '2': part.endings['2'].map(simplifyCell) }),
      },
      coda: simplifyCells(part.coda),
      transition_in: simplifyCells(part.transition_in),
    })),
    coda: simplifyCells(grille.coda),
  };
}

/** Deux cellules portent-elles exactement les mêmes accords ? */
function sameCells(a: GrilleCell, b: GrilleCell): boolean {
  return a.length === b.length && a.every((chord, i) => chord === b[i]);
}

/** Deux suites de mesures sont-elles identiques ? */
function sameSequence(a: GrilleCell[], b: GrilleCell[]): boolean {
  return a.length === b.length && a.every((cell, i) => sameCells(cell, b[i] ?? []));
}

/**
 * Remplace par une mesure « tenue » (`[]`) toute mesure vide *ou* identique à
 * la précédente : c'est le signe `%` de la convention jazz, et non un accord
 * réécrit à l'identique. Le masquage et le rendu partent tous deux de là.
 */
function normalizeSequence(seq: GrilleCell[]): GrilleCell[] {
  const out: GrilleCell[] = [];
  let previous: GrilleCell | null = null;
  for (const cell of seq) {
    if (cell.length === 0 || (previous && sameCells(cell, previous))) {
      out.push([]);
    } else {
      out.push(cell);
      previous = cell;
    }
  }
  return out;
}

/** Rang global (0-based) de chaque cellule masquable d'une grille. */
function buildSlots(grille: Grille): Slot[] {
  const slots: Slot[] = [];
  let ordinal = 0;
  for (const part of grille.parts) {
    let firstInPart = true;
    normalizeSequence(part.sequence).forEach((cell, index) => {
      if (cell.length === 0) return; // « % » : rien à masquer
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

  /**
   * Pose les données, une fois le fichier `data/grilles/<id>.json` chargé.
   * Les chiffrages sont simplifiés ici, à l'entrée : c'est la seule forme que
   * la grille affiche.
   */
  setGrille(grille: Grille | null): void {
    this.grille = grille ? simplifyGrille(grille) : null;
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

    // Curseur de ligne : `col` = colonne courante (0 à 3) après celle des
    // numéros de mesure. On remplit les lignes sans jamais revenir à la ligne
    // tant qu'il reste des cases : les fins de partie prolongent la séquence.
    let col = 0;
    const place = (node: HTMLElement, label = ''): void => {
      if (col === 0) grid.appendChild(el('span', { class: 'grille-barno' }, label));
      grid.appendChild(node);
      col = (col + 1) % BARS_PER_LINE;
    };
    const closeRow = (): void => {
      while (col !== 0) place(el('div', { class: 'chord-cell pad' }));
    };

    if (part.transition_in && part.transition_in.length > 0) {
      pushLabeledRow(grid, 'transition', part.transition_in);
    }

    const seq = normalizeSequence(part.sequence);
    let ordinal = startOrdinal;
    seq.forEach((cell, i) => {
      place(this.measureCell(cell, ordinal), barLabel(part, i));
      if (cell.length > 0) ordinal += 1;
    });

    // Fins de partie. Deux fins identiques ne sont que les mesures de
    // conclusion : on les écrit une seule fois, sans crochet ni numéro.
    const e1 = part.endings?.['1'];
    const e2 = part.endings?.['2'];
    const split = Boolean(e1 && e2 && !sameSequence(e1, e2));
    const inlineEnd = split ? e1 : (e1 ?? e2);
    const endStartCol = col;

    if (inlineEnd && inlineEnd.length > 0) {
      normalizeSequence(inlineEnd).forEach((cell, k) => {
        place(endingCell(cell, split, split && k === 0 ? '1.' : ''));
      });
    }
    closeRow();

    if (split && e2 && e2.length > 0) {
      // 2e fin : rangée courte, alignée sous la 1re fin quand elle y tient.
      const alignCol =
        endStartCol + e2.length <= BARS_PER_LINE ? endStartCol : 0;
      grid.appendChild(el('span', { class: 'grille-barno' }, ''));
      for (let p = 0; p < alignCol; p += 1) {
        grid.appendChild(el('div', { class: 'chord-cell pad' }));
      }
      normalizeSequence(e2).forEach((cell, k) => {
        grid.appendChild(endingCell(cell, true, k === 0 ? '2.' : ''));
      });
      for (let p = alignCol + e2.length; p < BARS_PER_LINE; p += 1) {
        grid.appendChild(el('div', { class: 'chord-cell pad' }));
      }
    }

    if (part.coda && part.coda.length > 0) {
      pushLabeledRow(grid, 'coda', part.coda);
    }

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

/** Cellule « % » : mesure tenue ou répétée (convention jazz). */
function simileCell(variant?: 'ending'): HTMLElement {
  const cls = 'chord-cell simile' + (variant === 'ending' ? ' chord-cell--ending' : '');
  return el('div', { class: cls }, el('span', { class: 'ch' }, '%'));
}

/**
 * Cellule d'une mesure de fin de partie. `bracketed` trace le crochet (trait
 * supérieur) ; `label` (« 1. » / « 2. ») n'est posé que sur la première.
 */
function endingCell(chords: GrilleCell, bracketed: boolean, label: string): HTMLElement {
  const variant = bracketed ? 'ending' : undefined;
  const cell =
    chords.length === 0 ? simileCell(variant) : chordCell(chords, variant);
  if (label) cell.appendChild(el('span', { class: 'grille-end-label' }, label));
  return cell;
}

/** Rangée annexe (coda, transition) : un libellé pleine largeur puis les mesures. */
function pushLabeledRow(grid: HTMLElement, label: string, seq: GrilleCell[]): void {
  grid.appendChild(el('div', { class: 'grille-row-label' }, label));
  let col = 0;
  for (const cell of normalizeSequence(seq)) {
    if (col === 0) grid.appendChild(el('span', { class: 'grille-barno' }, ''));
    grid.appendChild(cell.length === 0 ? simileCell() : chordCell(cell));
    col = (col + 1) % BARS_PER_LINE;
  }
  while (col !== 0) {
    grid.appendChild(el('div', { class: 'chord-cell pad' }));
    col = (col + 1) % BARS_PER_LINE;
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
