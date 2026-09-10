/** Petites icônes SVG (tracés type Lucide), monochromes, `currentColor`.
 *
 * `el()` ne sait créer que des éléments HTML ; ici on passe par `createElementNS`
 * pour le namespace SVG. Chaque fabrique rend une icône 24×24 prête à styler
 * (classe `h-5 w-5` posée à l'usage).
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(paths: string[]): SVGSVGElement {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', 'h-5 w-5');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    node.appendChild(path);
  }
  return node;
}

/** Signe « plus » — créer. */
export function plus(): SVGSVGElement {
  return svg(['M12 5v14', 'M5 12h14']);
}

/** Crayon — modifier. */
export function pencil(): SVGSVGElement {
  return svg([
    'M12 20h9',
    'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  ]);
}

/** Chevron vers le haut — monter dans une liste. */
export function chevronUp(): SVGSVGElement {
  return svg(['M18 15l-6-6-6 6']);
}

/** Chevron vers le bas — descendre dans une liste. */
export function chevronDown(): SVGSVGElement {
  return svg(['M6 9l6 6 6-6']);
}

/** Corbeille — supprimer. */
export function trash(): SVGSVGElement {
  return svg([
    'M3 6h18',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
    'M10 11v6',
    'M14 11v6',
  ]);
}
