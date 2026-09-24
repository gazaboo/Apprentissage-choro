/** Dessin SVG d'une portée mise en page par `technique/portee.ts`.
 *
 * Rien ne se calcule ici : chaque coordonnée vient de la mise en page, en
 * unités de portée, et le `viewBox` les reprend telles quelles. Seule la
 * largeur CSS du SVG est posée ici, en proportion de `LARGEUR_REFERENCE` :
 * toutes les portées sont ainsi à la même échelle dans un même conteneur,
 * et plafonnées pour ne pas devenir énormes sur un grand écran.
 */

import {
  INTERLIGNE,
  LARGEUR_REFERENCE,
  TAILLE_TEXTE,
  TETE_DEMI_LARGEUR,
  HAMPE,
  CLE_X,
  DEBORD_LIGNE_SUPPLEMENTAIRE,
  type MiseEnPortee,
  type NotePlacee,
} from '../technique/portee';

const NS = 'http://www.w3.org/2000/svg';

/** Échelle maximale : au-delà, un interligne dépasserait 13,5 px. */
const ECHELLE_MAX = 1.35;

/**
 * Couleurs de la portée : les variables de l'échelle Tailwind plutôt que des
 * valeurs littérales, pour suivre le thème clair (#177, voir `style.css`).
 * Elles passent par l'attribut `style` (voir `noeud`) : `var()` n'est pas
 * garanti dans les attributs de présentation SVG sur tous les navigateurs.
 */
const COULEUR = {
  ligne: 'var(--color-zinc-600)',
  encre: 'var(--color-zinc-100)',
  discret: 'var(--color-zinc-500)',
  cle: 'var(--color-zinc-300)',
  actif: 'var(--color-amber-400)',
  actifTexte: 'var(--color-amber-300)',
  juste: 'var(--color-emerald-400)',
  faux: 'var(--color-rose-400)',
  emplacement: 'var(--color-zinc-700)',
  /** Fonds translucides : halo de la note en cours, verdicts du micro. */
  halo: 'color-mix(in oklab, var(--color-amber-400) 13%, transparent)',
  fondJuste: 'color-mix(in oklab, var(--color-emerald-400) 16%, transparent)',
  fondFaux: 'color-mix(in oklab, var(--color-rose-400) 16%, transparent)',
};

export type Verdict = 'juste' | 'faux';

export interface EtatPortee {
  /** Les têtes de note sont-elles montrées, ou seulement leurs emplacements ? */
  revelee: boolean;
  /** Note en cours (métronome, écoute), ou `-1`. */
  active: number;
  /** Verdicts du micro sur la passe en cours, par position. */
  verdicts: Map<number, Verdict>;
  /** Degré de chaque note (« 1 », « ♭3 »…), affiché sous la portée. */
  degres: string[];
}

function noeud<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...enfants: (SVGElement | string)[]
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'fill' || k === 'stroke') n.style.setProperty(k, String(v));
    else n.setAttribute(k, String(v));
  }
  for (const e of enfants) n.append(e);
  return n;
}

/**
 * Clé de sol, domaine public (Wikimedia Commons, « G-clef.svg », Rémi
 * Cormier). Son tracé d'origine est dessiné à presque dix unités par
 * interligne — celles de la mise en page —, il suffit donc de le translater
 * pour poser sa spirale sur la ligne de sol.
 */
const CLE_TRACE =
  'M39.709 63.679C39.317 65.771 41.5 70.115 45.891 70.257C51.199 70.429 54.59 66.368 53.01 59.741' +
  'L45.087 23.172C44.143 18.818 44.851 16.457 45.355 15.05C46.699 11.296 50.056 9.747 50.873 10.949' +
  'C51.34 11.635 52.468 14.844 49.256 20.591C46.751 25.073 35.097 30.95 34.242 41.468' +
  'C33.501 50.614 43.076 57.369 51.339 54.714C56.826 52.951 59.654 44.624 56.258 40.329' +
  'C47.296 28.994 32.924 46.341 46.847 51.094C45.333 49.902 44.301 48.98 44.109 47.853' +
  'C42.238 36.877 58.741 39.775 54.294 50.187C52.466 54.469 45.08 55.297 40.874 51.477' +
  'C37.351 48.278 35.787 42.113 39.708 37.688C45.019 31.694 51.289 26.314 52.954 18.109' +
  'C54.923 8.406 48.494 0.842 44.429 10.386C43.065 13.588 42.557 16.803 43.863 22.964' +
  'L51.781 60.311C52.347 62.985 51.968 66.664 49.472 68.355C48.236 69.193 43.862 69.77 42.792 67.77';
/** Boule de la queue de la clé, dans le même repère que le tracé. */
const CLE_BOULE = { cx: 43.384, cy: 64.063, r: 3.75 };
/** Bord gauche du tracé et hauteur de la ligne de sol, dans son repère d'origine. */
const CLE_GAUCHE = 33.5;
const CLE_SOL = 44.3;
/** Mise à l'échelle du tracé : la clé monte de 4,4 interlignes au-dessus de sa
 *  ligne de sol et descend de 2,6 en dessous, les proportions de la gravure. */
const CLE_ECHELLE = 1.15;

function cle(mise: MiseEnPortee): SVGGElement {
  const g = noeud('g', {
    fill: COULEUR.cle,
    transform: `translate(${CLE_X} ${mise.ligneSol}) scale(${CLE_ECHELLE}) translate(${-CLE_GAUCHE} ${-CLE_SOL})`,
  });
  g.append(
    noeud('path', { d: CLE_TRACE, stroke: COULEUR.cle, 'stroke-width': 0.3 }),
    noeud('circle', CLE_BOULE),
  );
  // Le « 8 » de l'octave, centré sous la queue.
  const huit = noeud(
    'text',
    {
      x: CLE_X + 12,
      y: mise.ligneSol + 4 * INTERLIGNE,
      'text-anchor': 'middle',
      'font-size': 11,
      'font-weight': 600,
      'font-family': 'inherit',
      fill: COULEUR.cle,
    },
    '8',
  );
  const bloc = noeud('g', {});
  bloc.append(g, huit);
  return bloc as SVGGElement;
}

/** Altération dessinée à la main : aucune police musicale n'est chargée. */
function alteration(alter: number, x: number, y: number, couleur: string): SVGGElement {
  const g = noeud('g', { fill: couleur, stroke: couleur, 'stroke-linecap': 'round' });
  const bemol = (bx: number): void => {
    g.append(
      noeud('line', { x1: bx + 1, y1: y - 17, x2: bx + 1, y2: y + 5, 'stroke-width': 1.3 }),
      noeud('path', {
        d: `M${bx + 1} ${y - 1.5}C${bx + 4} ${y - 5.5} ${bx + 8.5} ${y - 5} ${bx + 7} ${y - 1}` +
          `C${bx + 6} ${y + 1.6} ${bx + 3.4} ${y + 3.6} ${bx + 1} ${y + 5}`,
        fill: 'none',
        'stroke-width': 1.6,
      }),
    );
  };
  if (alter === 1) {
    // Deux verticales, deux barres épaisses montantes.
    g.append(
      noeud('line', { x1: x + 2.6, y1: y - 12, x2: x + 2.6, y2: y + 14, 'stroke-width': 1.2 }),
      noeud('line', { x1: x + 6.4, y1: y - 14, x2: x + 6.4, y2: y + 12, 'stroke-width': 1.2 }),
      noeud('path', { d: `M${x} ${y - 3}L${x + 9} ${y - 6.2}L${x + 9} ${y - 3.2}L${x} ${y}Z`, stroke: 'none' }),
      noeud('path', { d: `M${x} ${y + 5}L${x + 9} ${y + 1.8}L${x + 9} ${y + 4.8}L${x} ${y + 8}Z`, stroke: 'none' }),
    );
  } else if (alter === 2) {
    g.append(
      noeud('path', {
        d: `M${x + 1} ${y - 4}L${x + 8} ${y + 4}M${x + 8} ${y - 4}L${x + 1} ${y + 4}`,
        fill: 'none',
        'stroke-width': 1.8,
      }),
    );
  } else if (alter === -1) {
    bemol(x);
  } else if (alter === -2) {
    bemol(x);
    bemol(x + 5.5);
  }
  return g as SVGGElement;
}

function couleurNote(i: number, etat: EtatPortee): string {
  if (i === etat.active) return COULEUR.actif;
  const v = etat.verdicts.get(i);
  if (v === 'juste') return COULEUR.juste;
  if (v === 'faux') return COULEUR.faux;
  return COULEUR.encre;
}

function note(n: NotePlacee, i: number, mise: MiseEnPortee, etat: EtatPortee): SVGGElement {
  const g = noeud('g', { 'data-note': i });
  const haut = mise.lignes[0]!;
  if (i === etat.active) {
    g.append(
      noeud('rect', {
        x: n.x - 15,
        y: haut - 22,
        width: 30,
        height: mise.yPied - haut + 26,
        rx: 7,
        fill: COULEUR.halo,
      }),
    );
  }

  if (!etat.revelee) {
    // Un emplacement par note : on voit la place, le rythme, pas la hauteur.
    // Il couvre toute la zone où la note peut tomber, des lignes du haut aux
    // lignes supplémentaires du grave : la portée garde ainsi le même
    // encombrement masquée ou révélée, sans laisser de vide sous les lignes.
    const v = etat.verdicts.get(i);
    const trait =
      i === etat.active ? COULEUR.actif : v === 'juste' ? COULEUR.juste : v === 'faux' ? COULEUR.faux : COULEUR.emplacement;
    const fond =
      v === 'juste' ? COULEUR.fondJuste : v === 'faux' ? COULEUR.fondFaux : 'none';
    g.append(
      noeud('rect', {
        x: n.x - 8,
        y: haut - 8,
        width: 16,
        height: mise.yPied - haut + 8 - 4,
        rx: 8,
        fill: fond,
        stroke: trait,
        'stroke-width': 1.2,
        'stroke-dasharray': v ? 'none' : '3 3',
      }),
    );
    return g as SVGGElement;
  }

  const couleur = couleurNote(i, etat);
  for (const y of n.lignesSupplementaires) {
    g.append(
      noeud('line', {
        x1: n.x - TETE_DEMI_LARGEUR - DEBORD_LIGNE_SUPPLEMENTAIRE,
        x2: n.x + TETE_DEMI_LARGEUR + DEBORD_LIGNE_SUPPLEMENTAIRE,
        y1: y,
        y2: y,
        stroke: COULEUR.ligne,
        'stroke-width': 1.1,
      }),
    );
  }
  const xHampe = n.hampe === 'haut' ? n.x + TETE_DEMI_LARGEUR - 0.7 : n.x - TETE_DEMI_LARGEUR + 0.7;
  g.append(
    noeud('line', {
      x1: xHampe,
      x2: xHampe,
      y1: n.y + (n.hampe === 'haut' ? -1 : 1),
      y2: n.y + (n.hampe === 'haut' ? -HAMPE : HAMPE),
      stroke: couleur,
      'stroke-width': 1.3,
    }),
    noeud('ellipse', {
      cx: n.x,
      cy: n.y,
      rx: TETE_DEMI_LARGEUR,
      ry: 4.4,
      transform: `rotate(-20 ${n.x} ${n.y})`,
      fill: couleur,
    }),
  );
  if (n.xAlteration !== null) g.append(alteration(n.alter, n.xAlteration, n.y, couleur));
  return g as SVGGElement;
}

/**
 * Nom d'une note pour l'affichage : « F# » → « F♯ », « Bbb » → « B♭♭ ». Les
 * doubles altérations restent doublées plutôt que 𝄪 et 𝄫, que les polices
 * courantes n'ont pas. La lettre est toujours en majuscule, seul un « b »
 * minuscule est un bémol.
 */
export function nomAffiche(nom: string): string {
  return nom.replace(/#/g, '♯').replace(/b/g, '♭');
}

export function dessinerPortee(mise: MiseEnPortee, etat: EtatPortee): SVGSVGElement {
  const svg = noeud('svg', {
    viewBox: `0 0 ${mise.largeur} ${mise.hauteur}`,
    role: 'img',
    class: 'portee block h-auto',
    'data-portee': '',
  });
  // Même échelle pour toutes les portées : la largeur suit la longueur du
  // motif, rapportée au plus long possible.
  svg.style.width = `${(mise.largeur / LARGEUR_REFERENCE) * 100}%`;
  svg.style.maxWidth = `${mise.largeur * ECHELLE_MAX}px`;
  svg.setAttribute(
    'aria-label',
    etat.revelee
      ? `Portée : ${mise.notes.map((n) => nomAffiche(n.nom)).join(', ')}`
      : `Portée : ${mise.notes.length} notes, masquées`,
  );

  for (const y of mise.lignes) {
    svg.append(noeud('line', { x1: mise.x0, x2: mise.x1, y1: y, y2: y, stroke: COULEUR.ligne, 'stroke-width': 1 }));
  }
  svg.append(cle(mise));

  if (mise.separation !== null) {
    svg.append(
      noeud('line', {
        x1: mise.separation,
        x2: mise.separation,
        y1: mise.lignes[0]! - 14,
        y2: mise.lignes[4]! + 14,
        stroke: COULEUR.emplacement,
        'stroke-width': 1.2,
        'stroke-dasharray': '3 4',
      }),
    );
  }

  mise.notes.forEach((n, i) => {
    svg.append(note(n, i, mise, etat));
    const actif = i === etat.active;
    if (etat.revelee) {
      svg.append(
        noeud(
          'text',
          {
            x: n.x,
            y: mise.yNoms,
            'text-anchor': 'middle',
            'font-size': TAILLE_TEXTE,
            'font-weight': 600,
            'font-family': 'inherit',
            fill: actif ? COULEUR.actifTexte : COULEUR.encre,
            'data-nom': '',
          },
          nomAffiche(n.nom),
        ),
      );
    }
    svg.append(
      noeud(
        'text',
        {
          x: n.x,
          y: mise.yDegres,
          'text-anchor': 'middle',
          'font-size': TAILLE_TEXTE - 1,
          'font-family': 'inherit',
          fill: actif ? COULEUR.actifTexte : COULEUR.discret,
        },
        etat.degres[i] ?? '',
      ),
    );
  });
  return svg;
}
