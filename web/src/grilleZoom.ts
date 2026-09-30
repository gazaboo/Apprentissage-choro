/**
 * Paliers de taille de la grille d'accords (boutons − / + de la carte).
 *
 * La grille garde ses quatre mesures par ligne sur téléphone (huit sur écran
 * large) : couper une phrase de quatre mesures gênerait plus la lecture que des
 * lettres plus petites. Agrandir, c'est donc hausser les cases et le corps des
 * accords, et non élargir la carte. Au palier 1, une case fait environ 42 px de
 * haut sur un téléphone de 390 px — la densité retenue sur maquettes pour que
 * la plupart des choros tiennent sur un écran ou presque.
 *
 * La largeur d'une case, elle, ne change pas : passé un certain palier, les
 * chiffrages longs et les mesures partagées cessent de grossir, bornés par la
 * largeur, et seuls les accords courts continuent de profiter du zoom.
 *
 * Module à part, sans DOM, pour que `store.ts` puisse valider le réglage
 * enregistré sans tirer la vue de la grille.
 */
export const GRILLE_ZOOM_LEVELS = [0.85, 1, 1.25, 1.5, 1.9] as const;

export const DEFAULT_GRILLE_ZOOM = 1;
export const GRILLE_ZOOM_MIN = GRILLE_ZOOM_LEVELS[0];
export const GRILLE_ZOOM_MAX = GRILLE_ZOOM_LEVELS[GRILLE_ZOOM_LEVELS.length - 1] as number;

/** Ramène une valeur quelconque (réglage ancien, synchro corrompue) au palier le plus proche. */
export function nearestGrilleZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GRILLE_ZOOM;
  let best: number = DEFAULT_GRILLE_ZOOM;
  for (const level of GRILLE_ZOOM_LEVELS) {
    if (Math.abs(level - value) < Math.abs(best - value)) best = level;
  }
  return best;
}

/** Palier voisin, dans le sens demandé ; reste sur place aux extrémités. */
export function stepGrilleZoom(current: number, direction: 1 | -1): number {
  const index = GRILLE_ZOOM_LEVELS.indexOf(nearestGrilleZoom(current) as (typeof GRILLE_ZOOM_LEVELS)[number]);
  const next = Math.min(GRILLE_ZOOM_LEVELS.length - 1, Math.max(0, index + direction));
  return GRILLE_ZOOM_LEVELS[next] ?? DEFAULT_GRILLE_ZOOM;
}
