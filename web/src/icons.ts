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

/** Notes de musique — répertoire. */
export function music(): SVGSVGElement {
  return svg([
    'M9 18V5l12-2v13',
    'M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    'M15 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  ]);
}

/** Tracé en dents de scie — technique (exercices au métronome). */
export function activity(): SVGSVGElement {
  return svg(['M22 12h-4l-3 9L9 3l-3 9H2']);
}

/** Silhouette — compte. */
export function user(): SVGSVGElement {
  return svg([
    'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2',
    'M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
  ]);
}

/** Point d'interrogation cerclé — aide. */
export function help(): SVGSVGElement {
  return svg([
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
    'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
    'M12 17h.01',
  ]);
}

/** Chevron vers la gauche — revenir. */
export function chevronLeft(): SVGSVGElement {
  return svg(['M15 18l-6-6 6-6']);
}

/** Œil — voir les notes. */
export function eye(): SVGSVGElement {
  return svg([
    'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  ]);
}

/** Haut-parleur — écouter le motif. */
export function volume(): SVGSVGElement {
  return svg(['M11 5L6 9H2v6h4l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7']);
}

/** Flèches en boucle — rejouer en continu. */
export function repeat(): SVGSVGElement {
  return svg([
    'M17 2l4 4-4 4',
    'M3 11V10a4 4 0 0 1 4-4h14',
    'M7 22l-4-4 4-4',
    'M21 13v1a4 4 0 0 1-4 4H3',
  ]);
}

/** Micro — évaluation au micro. */
export function mic(): SVGSVGElement {
  return svg([
    'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z',
    'M5 10a7 7 0 0 0 14 0',
    'M12 17v4',
  ]);
}

/** Croix — annuler. */
export function x(): SVGSVGElement {
  return svg(['M18 6L6 18', 'M6 6l12 12']);
}

/** Signe « moins » — ralentir. */
export function minus(): SVGSVGElement {
  return svg(['M5 12h14']);
}

/** Icône pleine : les formes de lecture se lisent mieux remplies que tracées. */
function filled(paths: string[]): SVGSVGElement {
  const node = svg(paths);
  node.setAttribute('fill', 'currentColor');
  node.setAttribute('stroke', 'none');
  return node;
}

/** Triangle de lecture, décalé d'un pixel vers la droite pour paraître centré. */
export function play(): SVGSVGElement {
  return filled(['M8 5.5v13l11-6.5z']);
}

/** Deux barres de pause. */
export function pause(): SVGSVGElement {
  return filled(['M6.5 5h4v14h-4z', 'M13.5 5h4v14h-4z']);
}
