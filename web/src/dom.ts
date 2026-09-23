/** Petites fabriques DOM, pour écrire les vues sans framework. */

import { formatTime, RATE_MAX, RATE_MIN, stepBpm, stepRate } from './audio';
import type { AudioKind } from './types';

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** `el('button', { class: '…' }, 'Texte')` — attributs et enfants optionnels. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** Classes partagées, pour garder les vues cohérentes sans les répéter.
 *
 * Tous les contrôles font au moins 44 × 44 px (`min-h-11 min-w-11`) : la
 * cible tactile minimale pour qu'on les atteigne d'une main, l'instrument
 * dans l'autre.
 *
 * ## Ce que dit l'ambre (#137)
 *
 * L'accent ambre s'était posé partout : sur l'action principale, sur chaque
 * bascule active, sur le bouton de lecture. Trois choses sans rapport, une
 * seule couleur — elle ne signalait donc plus rien. Le vocabulaire tient
 * désormais en trois règles :
 *
 * - **Ambre plein** (`primary`) : l'action principale de l'écran. *Une seule
 *   à la fois.* Sur l'écran d'entraînement, c'est le bouton de lecture.
 * - **Ambre vivant** : ce qui tourne en ce moment — la lecture en cours, la
 *   boucle active. Un état transitoire, jamais un réglage.
 * - **Sélection** (`*Active`, `ui.selected`) : ambre discret — texte et
 *   bordure seulement, sur la surface neutre (#162). C'est ce qui la sépare
 *   de l'ambre vivant, dont la surface est teintée. Trois canaux à la fois —
 *   couleur, bordure doublée d'un anneau interne, texte plus gras — pour
 *   rester identifiable sans dépendre de la couleur seule.
 *
 * L'anneau de focus reste ambre : il dit « le clavier est ici », ce qui est
 * une quatrième question, orthogonale aux trois autres.
 */
/**
 * Marque d'un contrôle sélectionné, commune à toute l'app (#162). Ajoutée à un
 * gabarit dont on a retiré bordure, texte et graisse ; l'anneau interne double
 * la bordure sans décaler la mise en page.
 */
const SELECTED =
  'border-amber-400/80 ring-1 ring-inset ring-amber-400/80 font-semibold text-amber-300';

export const ui = {
  /** Fragment d'état sélectionné, pour les contrôles faits main. */
  selected: SELECTED,
  button:
    'inline-flex min-h-11 items-center justify-center rounded-lg border ' +
    'border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-200 ' +
    'transition hover:border-zinc-500 hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800',
  buttonActive:
    'inline-flex min-h-11 items-center justify-center rounded-lg border ' +
    `bg-zinc-800 px-4 text-sm ${SELECTED} ` +
    'transition hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400',
  primary:
    'inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-400 ' +
    'px-5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ' +
    'disabled:cursor-not-allowed disabled:opacity-40',
  /**
   * Bascule compacte de la barre de transport : un seul bouton qui montre
   * l'état courant (source, vitesse, transposition), un appui pour changer.
   * Largeur libre, hauteur tactile.
   */
  chip:
    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg ' +
    'border border-zinc-700 bg-zinc-800 px-3 text-xs font-semibold text-zinc-200 ' +
    'transition hover:border-zinc-500 hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800',
  chipActive:
    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg ' +
    `border bg-zinc-800 px-3 text-xs ${SELECTED} ` +
    'transition hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400',
  /** Contrôle carré et compact (icône seule) de la barre de transport. */
  icon:
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' +
    'border border-zinc-700 bg-zinc-800/80 text-base text-zinc-300 ' +
    'transition hover:border-zinc-500 hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40',
  iconActive:
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' +
    `border bg-zinc-800/80 text-base ${SELECTED} ` +
    'transition hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400',
  card: 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4',
  label: 'text-xs font-semibold uppercase tracking-wider text-zinc-500',
};

/** Les trois gabarits de contrôle à bascule de `ui`. */
export type ToggleVariant = 'button' | 'chip' | 'icon';

/**
 * Contenu icône + libellé d'un bouton : l'icône reste visible en permanence,
 * le libellé se masque sous `max-md:hidden`. Le bouton se lit en icône seule
 * sur mobile — l'appelant doit alors poser un `aria-label` sur le bouton
 * lui-même, faute de quoi son nom accessible disparaît avec le texte masqué —
 * et en icône + texte complet au-delà, sans rien changer au desktop (#150).
 */
export function iconLabel(icon: string, label: string): HTMLElement {
  return el(
    'span',
    { class: 'inline-flex items-center gap-1.5' },
    el('span', { 'aria-hidden': 'true' }, icon),
    el('span', { class: 'max-md:hidden' }, label),
  );
}

/**
 * Dit l'état d'un contrôle **hors du style** : `data-state="on" | "off"`.
 *
 * Sans lui, le seul témoin de « ce bouton est actif » est sa classe
 * utilitaire, si bien qu'un test qui vérifie un état doit affirmer une
 * couleur (`bg-amber-400/15`) et se casse au premier changement de palette.
 * Le marqueur sépare les deux questions : `data-state` porte l'état,
 * les classes portent son apparence.
 */
export function setState(element: HTMLElement, on: boolean): void {
  element.dataset.state = on ? 'on' : 'off';
}

/** Peint un contrôle à bascule : le gabarit correspondant à l'état, et `data-state`. */
export function paintToggle(
  element: HTMLElement,
  on: boolean,
  variant: ToggleVariant = 'button',
  extra = '',
): void {
  const base = on ? ui[`${variant}Active` as const] : ui[variant];
  element.className = extra ? `${base} ${extra}` : base;
  setState(element, on);
}

/**
 * Bouton de lecture rond du dock, commun à l'entraînement et au filage.
 *
 * Les deux écrans en avaient chacun le leur, à deux tailles différentes
 * (56 px et 64 px) et avec deux façons d'écrire l'icône (#137).
 */
export function createPlayButton(options: {
  onToggle: () => void;
  disabled?: boolean;
}): { root: HTMLButtonElement; set(playing: boolean): void } {
  const icon = el('span', { class: 'text-xl leading-none' }, '▶');
  const root = el(
    'button',
    {
      type: 'button',
      // 48 px partout : sur mobile il voisine avec les boutons ±5 s et les
      // pastilles de 40 px, plus un cercle géant à côté de boutons minuscules
      // (#153).
      class:
        'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ' +
        'bg-amber-400 pl-1 text-zinc-950 shadow-lg shadow-amber-400/20 ' +
        'transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 ' +
        'focus-visible:ring-amber-400 focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed ' +
        'disabled:opacity-40',
      'aria-label': 'Lecture ou pause',
      disabled: options.disabled ?? false,
    },
    icon,
  );
  root.addEventListener('click', options.onToggle);
  return {
    root,
    set(playing) {
      icon.textContent = playing ? '❚❚' : '▶';
      // Le triangle n'est pas centré optiquement ; la pause l'est.
      root.classList.toggle('pl-1', !playing);
    },
  };
}

/** Barre de défilement du dock : la piste, le geste, et rien d'autre. */
export interface SeekBar {
  root: HTMLElement;
  /** La piste elle-même, où poser des décorations (bande de boucle, repères). */
  track: HTMLElement;
  /** Repeint la position. Sans effet pendant un glissement : le doigt prime. */
  set(currentTime: number, duration: number): void;
  /** Vrai tant que le doigt est posé. Le filage s'en sert pour ne pas prendre
   *  un glissement vers la fin du morceau pour la fin du morceau. */
  isScrubbing(): boolean;
}

/**
 * Barre de défilement partagée entre l'entraînement et le filage.
 *
 * Les deux en avaient une, et elles ne se comportaient pas pareil : le filage
 * déplaçait le lecteur à *chaque* mouvement du doigt, l'entraînement
 * seulement au relâchement. On retient le second — sur un fichier long,
 * relancer le décodage à chaque pixel hache la lecture (#137).
 */
export function createSeekBar(options: {
  /** Appelé au relâchement seulement, en secondes. */
  onSeek: (seconds: number) => void;
  /** Appelé à chaque repeinte — battement du lecteur comme glissement du
   *  doigt — pour que l'appelant place ses propres décorations. */
  onPaint?: (ratio: number, seconds: number) => void;
  decorations?: HTMLElement[];
}): SeekBar {
  const fill = el('div', { class: 'absolute inset-y-0 left-0 rounded-full bg-amber-400' });
  // Poignée et bulle de temps, visibles sous 768 px seulement (`style.css`) :
  // au doigt, on ne voit pas où l'on est ni où l'on attrape sans elles (#153).
  const knob = el('div', { class: 'seek-knob', 'aria-hidden': 'true' });
  const bubble = el('div', { class: 'seek-bubble', 'aria-hidden': 'true' }, '0:00');
  const track = el(
    'div',
    { class: 'seek-track relative w-full rounded-full bg-zinc-700' },
    ...(options.decorations ?? []),
    fill,
    knob,
    bubble,
  );
  const root = el(
    'div',
    {
      // La zone de saisie fait 44 px de haut, même si la piste n'en fait que 4.
      // Sur mobile la boîte n'en dessine que 32, pour un dock plus bas ; un
      // pseudo-élément (`style.css`) rend les 12 px manquants à la saisie.
      class: 'seek-bar relative flex h-11 w-full min-w-0 flex-1 cursor-pointer items-center max-md:h-8',
      role: 'slider',
      'aria-label': 'Position dans le morceau',
      'aria-valuemin': 0,
      'aria-valuenow': 0,
    },
    track,
  );

  let scrubbing = false;
  let duration = 0;

  const ratioFrom = (event: PointerEvent): number => {
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  function paint(ratio: number, current: number): void {
    fill.style.width = `${ratio * 100}%`;
    knob.style.left = `${ratio * 100}%`;
    bubble.style.left = `${ratio * 100}%`;
    bubble.textContent = formatTime(current);
    root.setAttribute('aria-valuenow', String(Math.round(current)));
    root.setAttribute('aria-valuetext', formatTime(current));
    options.onPaint?.(ratio, current);
  }

  root.addEventListener('pointerdown', (event) => {
    if (!duration) return;
    scrubbing = true;
    root.classList.add('is-dragging');
    root.setPointerCapture(event.pointerId);
    const ratio = ratioFrom(event);
    paint(ratio, ratio * duration);
  });
  root.addEventListener('pointermove', (event) => {
    if (!scrubbing || !duration) return;
    const ratio = ratioFrom(event);
    paint(ratio, ratio * duration);
  });
  const endScrub = (event: PointerEvent): void => {
    if (!scrubbing) return;
    scrubbing = false;
    root.classList.remove('is-dragging');
    if (duration) options.onSeek(ratioFrom(event) * duration);
  };
  root.addEventListener('pointerup', endScrub);
  root.addEventListener('pointercancel', endScrub);

  return {
    root,
    track,
    isScrubbing: () => scrubbing,
    set(currentTime, total) {
      duration = total;
      root.setAttribute('aria-valuemax', String(Math.round(total)));
      if (scrubbing) return;
      paint(total ? currentTime / total : 0, currentTime);
    },
  };
}

/**
 * Piste et temps. Au-delà de 768 px, les temps encadrent la piste sur une
 * ligne. En dessous, ils passent **sous** la piste, aux deux bouts : à côté,
 * ils lui prenaient 75 px sur 375 (#153).
 *
 * `trailing`, s'il est fourni, suit la piste au-delà de 768 px seulement : le
 * filage y garde son « 0:12 / 3:10 » d'un seul tenant.
 */
export function createSeekRow(
  seekBar: HTMLElement,
  current: HTMLElement,
  duration: HTMLElement,
  trailing?: HTMLElement,
): HTMLElement {
  current.classList.add('max-md:justify-self-start');
  duration.classList.add('max-md:justify-self-end');
  return el(
    'div',
    {
      class:
        'grid w-full grid-cols-2 items-center text-[11px] max-md:leading-4 ' +
        'md:flex md:gap-2',
    },
    current,
    // Première sur mobile (pleine largeur), entre les temps au-delà.
    el('div', { class: 'col-span-2 min-w-0 max-md:order-first max-md:-mb-2 md:flex-1' }, seekBar),
    duration,
    trailing ?? null,
  );
}

/** Contour de flèche circulaire, chiffre au centre : l'icône de recul/avance
 *  que tous les lecteurs audio emploient. */
function skipIcon(direction: -1 | 1, seconds: number): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'h-7 w-7');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const arc = document.createElementNS(ns, 'path');
  arc.setAttribute('d', direction < 0 ? 'M9 9.5A10 10 0 1 1 6 16' : 'M23 9.5A10 10 0 1 0 26 16');
  const head = document.createElementNS(ns, 'path');
  head.setAttribute('d', direction < 0 ? 'M9 4.5v5h5' : 'M23 4.5v5h-5');
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', '16');
  text.setAttribute('y', '20.5');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', '700');
  text.setAttribute('fill', 'currentColor');
  text.setAttribute('stroke', 'none');
  text.textContent = String(seconds);
  svg.append(arc, head, text);
  return svg;
}

/**
 * Reculer ou avancer de quelques secondes. Revenir un peu en arrière est le
 * geste le plus fréquent du musicien qui travaille un passage : il ne doit
 * pas dépendre d'un pointage précis sur la piste (#153).
 */
export function createSkipButton(options: {
  direction: -1 | 1;
  seconds: number;
  onSkip: (deltaSeconds: number) => void;
  disabled?: boolean;
  extra?: string;
}): HTMLButtonElement {
  const button = el(
    'button',
    {
      type: 'button',
      class:
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ' +
        'text-zinc-200 transition hover:bg-zinc-800 focus:outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
        'disabled:cursor-not-allowed disabled:opacity-40' +
        (options.extra ? ` ${options.extra}` : ''),
      'aria-label': `${options.direction < 0 ? 'Reculer' : 'Avancer'} de ${options.seconds} secondes`,
      disabled: options.disabled ?? false,
    },
    skipIcon(options.direction, options.seconds),
  );
  button.addEventListener('click', () => options.onSkip(options.direction * options.seconds));
  return button;
}

/**
 * Contenu mobile d'une pastille de réglage du dock : une légende en petites
 * capitales (« Bande », « Vitesse », « Boucle ») au-dessus de la valeur. Une
 * icône seule (🎙, 1×) se devinait ; un mot se lit (#153). Masqué au-delà de
 * 768 px, où la pastille garde son rendu d'origine.
 */
export function captionedValue(caption: HTMLElement | string, value: HTMLElement | string): HTMLElement {
  return el(
    'span',
    { class: 'flex flex-col items-start gap-0.5 md:hidden' },
    typeof caption === 'string'
      ? el(
          'span',
          { class: 'text-[9px] font-bold uppercase leading-none tracking-wider text-zinc-500' },
          caption,
        )
      : caption,
    typeof value === 'string'
      ? el('span', { class: 'text-[13px] font-semibold leading-none text-zinc-100' }, value)
      : value,
  );
}

/** Gabarit mobile d'une pastille de réglage du dock : 40 px, légende au-dessus. */
export const DOCK_CHIP_MOBILE = 'max-md:h-10 max-md:min-h-0 max-md:min-w-0 max-md:justify-start max-md:px-2';

/**
 * Disposition du dock audio.
 *
 * Sous 768 px, deux rangées : la piste seule sur toute la largeur, puis la
 * lecture (±5 s autour du bouton) à gauche et les réglages à droite. Avant,
 * le bouton de lecture englobait les deux rangées et les temps encadraient la
 * piste : il lui restait 190 px sur 375 — pas plus que sur une seule ligne.
 * Pleine largeur, elle en a environ 350 (#153, variante A des maquettes).
 *
 * Au-delà, une seule ligne comme avant : lecture, piste, réglages. Les
 * rangées mobiles s'y dissolvent (`md:contents`) et `order` replace le bouton
 * de lecture devant la piste.
 */
export function createPlayerDock(options: {
  seek: HTMLElement;
  transport: HTMLElement[];
  settings: HTMLElement[];
  /** Au-delà de 768 px, les réglages passent sur une seconde ligne, pleine
   *  largeur : le filage en a trop pour laisser de la place à la piste. */
  settingsRowOnDesktop?: boolean;
}): HTMLElement {
  const ownRow = options.settingsRowOnDesktop ?? false;
  const transportGroup = el(
    'div',
    { class: 'flex shrink-0 items-center gap-1 md:order-1' },
    ...options.transport,
  );
  const settingsGroup = el(
    'div',
    {
      class:
        'flex shrink-0 items-center gap-1.5 md:order-3 md:gap-3' +
        (ownRow ? ' md:basis-full md:flex-wrap' : ''),
    },
    ...options.settings,
  );
  return el(
    'div',
    {
      class:
        'flex w-full flex-col gap-0.5 md:flex-row md:items-center md:gap-3' +
        (ownRow ? ' md:flex-wrap md:gap-y-2' : ''),
    },
    el('div', { class: 'min-w-0 md:order-2 md:flex-1' }, options.seek),
    el(
      'div',
      { class: 'flex items-center justify-between gap-1.5 md:contents' },
      transportGroup,
      settingsGroup,
    ),
  );
}

/**
 * Bascule Original ⇄ Playback, un aller-retour constant plutôt qu'un réglage
 * qu'on pose une fois : l'accompagnateur travaille sur l'enregistrement
 * complet, le soliste sur l'accompagnement seul, mais revient au thème.
 *
 * Le filage en avait une version à deux boutons segmentés, avec sa propre
 * classe ambre — restée en dehors du vocabulaire de couleur unifié. Une seule
 * pastille cyclique désormais : le dock est contraint en largeur (#137).
 */
export function createSourceToggle(options: {
  available: AudioKind[];
  current: AudioKind;
  onPick: (kind: AudioKind) => void;
  extra?: string;
}): { root: HTMLButtonElement; set(kind: AudioKind): void } {
  const LABELS: Record<AudioKind, string> = { reference: 'Original', playback: 'Playback' };
  // Icônes desktop seulement. Sur mobile, 🎙 et 🎧 seuls se devinaient mal :
  // la pastille y dit « Bande » au-dessus du nom de la bande (#153).
  const ICONS: Record<AudioKind, string> = { reference: '🎙', playback: '🎧' };
  const HINTS: Record<AudioKind, string> = {
    reference: 'Enregistrement original, thème compris',
    playback: 'Accompagnement seul, sans le thème',
  };
  const cycles = options.available.length > 1;
  let current = options.current;

  const root = el('button', {
    type: 'button',
    class:
      `${ui.chip} gap-1.5 ${DOCK_CHIP_MOBILE}` +
      `${options.extra ? ` ${options.extra}` : ''}`,
  });

  function paint(): void {
    root.replaceChildren(
      el(
        'span',
        { class: 'inline-flex items-center gap-1.5 max-md:hidden' },
        el('span', { 'aria-hidden': 'true' }, ICONS[current]),
        el('span', { class: 'font-semibold' }, LABELS[current]),
        cycles
          ? el('span', { class: 'text-sm leading-none opacity-60', 'aria-hidden': 'true' }, '⇄')
          : null,
      ),
      captionedValue('Bande', LABELS[current]),
    );
    root.title = HINTS[current];
    root.setAttribute(
      'aria-label',
      cycles ? `${HINTS[current]} — toucher pour changer` : HINTS[current],
    );
  }

  root.addEventListener('click', () => {
    if (!cycles) return;
    current = options.available[(options.available.indexOf(current) + 1) % options.available.length]!;
    paint();
    options.onPick(current);
  });

  paint();
  return {
    root,
    set(kind) {
      current = kind;
      paint();
    },
  };
}

/** Groupe à choix unique, repeint seul, dont la vue pilote la valeur. */
export interface Segmented<T extends string> {
  root: HTMLElement;
  /** Repositionne la sélection **sans** rappeler `onPick`. */
  set(value: T): void;
  /** Affiche ou masque le groupe entier (bascule indisponible pour ce morceau). */
  setVisible(visible: boolean): void;
}

/**
 * Groupe de bascules à choix unique, façon segmented control.
 *
 * Diffère de `segmented()` plus bas, qui garde sa valeur pour lui : ici la
 * vue reste seule source de vérité (elle peut refuser un choix, ou en imposer
 * un), et `set()` lui permet de repeindre après coup. C'est ce qu'il faut dès
 * que la même bascule existe en double — barre du haut et barre de plein
 * écran montrent le même choix d'affichage (#137).
 *
 * `icon`, s'il est fourni, bascule le rendu du bouton en icône + libellé
 * (`iconLabel`) : icône seule sur mobile, icône + texte au-delà — plutôt que
 * le texte abrégé de la barre de plein écran ("Mél."), jugé incompréhensible
 * (#150).
 */
export function createSegmented<T extends string>(
  options: { value: T; label: string; icon?: string }[],
  onPick: (value: T) => void,
  { variant = 'button', extra = '' }: { variant?: ToggleVariant; extra?: string } = {},
): Segmented<T> {
  const buttons = options.map((option) => {
    const button = el(
      'button',
      { type: 'button', 'aria-label': option.icon ? option.label : undefined },
      option.icon ? iconLabel(option.icon, option.label) : option.label,
    );
    button.addEventListener('click', () => onPick(option.value));
    return button;
  });
  const root = el('div', { class: 'flex items-center gap-1' }, ...buttons);
  return {
    root,
    set(value) {
      options.forEach((option, i) => paintToggle(buttons[i]!, option.value === value, variant, extra));
    },
    setVisible(visible) {
      root.classList.toggle('hidden', !visible);
      root.classList.toggle('flex', visible);
    },
  };
}

const segClass = (on: boolean): string =>
  'min-h-11 flex-1 rounded-lg border px-3 text-sm transition ' +
  (on
    ? `bg-zinc-800 ${SELECTED} hover:bg-zinc-700`
    : 'border-zinc-700 bg-zinc-800 font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700');

/** Groupe de boutons à choix unique, largeur égale. Rappelle `onPick` et se repeint seul. */
export function segmented<T extends string>(
  options: { value: T; label: string }[],
  initial: T,
  onPick: (value: T) => void,
): HTMLElement {
  let current = initial;
  const buttons = options.map((option) => {
    const button = el(
      'button',
      { type: 'button', class: segClass(option.value === current) },
      option.label,
    );
    setState(button, option.value === current);
    button.addEventListener('click', () => {
      current = option.value;
      buttons.forEach((other, i) => {
        const on = options[i]!.value === current;
        other.className = segClass(on);
        setState(other, on);
      });
      onPick(current);
    });
    return button;
  });
  return el('div', { class: 'flex gap-2' }, ...buttons);
}

/**
 * Ouvre et ferme un panneau ancré sur son bouton : un appui l'ouvre, un
 * second, un appui ailleurs ou Échap le ferment.
 *
 * Commun au panneau de vitesse du dock et aux menus de la barre du haut
 * (#153). Les écouteurs de `document` ne sont posés qu'à l'ouverture : fermé,
 * le panneau ne laisse rien traîner. `container` délimite le « dedans » —
 * le bouton et le panneau, qu'un appui ne doit pas refermer.
 */
export function createPopover(options: {
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  container: HTMLElement;
  onToggle?: (open: boolean) => void;
}): { setOpen(open: boolean): void; isOpen(): boolean } {
  const { trigger, panel, container } = options;
  let open = false;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const onOutside = (event: PointerEvent): void => {
    if (!container.contains(event.target as Node)) setOpen(false);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false);
  };
  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('flex', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      document.addEventListener('pointerdown', onOutside);
      document.addEventListener('keydown', onKey);
    } else {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
    }
    options.onToggle?.(open);
  }
  trigger.addEventListener('click', () => setOpen(!open));
  return { setOpen, isOpen: () => open };
}

/**
 * Menu déroulant de la barre du haut : son panneau, sous le bouton au-delà
 * de 768 px, et sur toute la largeur de l'écran en dessous — un panneau de
 * 320 px ancré à un bouton de droite sortirait de l'écran d'un téléphone.
 */
export function createTopBarMenu(options: {
  trigger: HTMLButtonElement;
  label: string;
  content: (HTMLElement | null)[];
  align?: 'left' | 'right';
}): { root: HTMLElement; panel: HTMLElement; setOpen(open: boolean): void } {
  const panel = el(
    'div',
    {
      class:
        'absolute top-full z-50 mt-2 hidden w-80 flex-col gap-4 rounded-xl border ' +
        'border-zinc-700 bg-zinc-900 p-4 text-left shadow-2xl shadow-black/60 ' +
        'max-md:fixed max-md:inset-x-3 max-md:top-14 max-md:mt-0 max-md:w-auto ' +
        (options.align === 'left' ? 'left-0' : 'right-0'),
      role: 'dialog',
      'aria-label': options.label,
    },
    ...options.content.filter((node): node is HTMLElement => node !== null),
  );
  const root = el('div', { class: 'relative shrink-0' }, options.trigger, panel);
  const popover = createPopover({ trigger: options.trigger, panel, container: root });
  return { root, panel, setOpen: popover.setOpen };
}

/** Rubrique d'un menu de la barre du haut : petite légende, puis son contenu. */
export function menuSection(title: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return el(
    'section',
    { class: 'flex flex-col gap-1.5' },
    el('h3', { class: 'text-[10px] font-bold uppercase tracking-wider text-zinc-500' }, title),
    ...body.filter((node): node is HTMLElement => node !== null),
  );
}

/**
 * Bloc titre de la barre du haut : une légende d'état au-dessus du titre, le
 * tout cliquable pour ouvrir un panneau de contexte (#153, variante 1 des
 * maquettes).
 *
 * La légende dit *où l'on est* (« Jamais travaillé », « Urgences · 2 sur 3 »,
 * « Filage · 1 sur 3 ») ; le panneau porte ce qui ne mérite pas un bouton
 * permanent, dont les sorties définitives (« Terminer la séance ») qu'on ne
 * veut plus voir à côté de « Suivant ».
 *
 * Le titre reste un vrai `h1`, hors du bouton (un bouton n'admet pas de
 * titre) : la surface cliquable est posée par-dessus (`.identity-hit`).
 */
export function createTopBarIdentity(options: {
  caption: (HTMLElement | string)[];
  title: string;
  subtitle?: string;
  /** Légende en ambre : on est dans une séance ou un filage. */
  accent?: boolean;
  /** Couleur du point d'état (`bg-…`), ou rien. */
  dot?: string;
  panelLabel: string;
  panel: (HTMLElement | null)[];
}): {
  root: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  setCaption(parts: (HTMLElement | string)[]): void;
  setOpen(open: boolean): void;
} {
  const caption = el('span', { class: 'flex min-w-0 items-center gap-1' });
  const setCaption = (parts: (HTMLElement | string)[]): void => {
    caption.replaceChildren(
      ...parts.map((part, i) =>
        typeof part === 'string'
          ? el('span', { class: i === 0 ? 'truncate' : 'shrink-0' }, part)
          : part,
      ),
    );
  };
  setCaption(options.caption);
  const title = el(
    'h1',
    { class: 'min-w-0 truncate text-[15px] font-semibold leading-tight text-zinc-100 md:text-lg' },
    options.title,
  );
  const subtitle = el(
    'span',
    { class: 'min-w-0 truncate text-sm text-zinc-500 max-md:hidden' },
    options.subtitle ?? '',
  );
  const hit = el('button', {
    type: 'button',
    class:
      'identity-hit absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 ' +
      'focus-visible:ring-amber-400',
    'aria-label': `${options.panelLabel} — détails`,
  });
  const panel = el(
    'div',
    {
      class:
        'absolute left-0 top-full z-50 mt-2 hidden w-80 flex-col gap-3 rounded-xl border ' +
        'border-zinc-700 bg-zinc-900 p-4 shadow-2xl shadow-black/60 ' +
        'max-md:fixed max-md:inset-x-3 max-md:top-14 max-md:mt-0 max-md:w-auto',
      role: 'dialog',
      'aria-label': options.panelLabel,
    },
    ...options.panel.filter((node): node is HTMLElement => node !== null),
  );
  const root = el(
    'div',
    { class: 'relative flex h-10 min-w-0 flex-1 flex-col justify-center' },
    el(
      'p',
      {
        class:
          'flex min-w-0 items-center gap-1.5 text-[11px] font-medium leading-tight md:text-xs ' +
          (options.accent ? 'text-amber-300' : 'text-zinc-400'),
      },
      options.dot ? el('span', { class: `h-2 w-2 shrink-0 rounded-full ${options.dot}`, 'aria-hidden': 'true' }) : null,
      caption,
      el('span', { class: 'shrink-0 text-zinc-600', 'aria-hidden': 'true' }, '▾'),
    ),
    el('div', { class: 'flex min-w-0 items-baseline gap-2' }, title, subtitle),
    hit,
    panel,
  );
  const popover = createPopover({ trigger: hit, panel, container: root });
  return { root, title, subtitle, setCaption, setOpen: popover.setOpen };
}

/** `123.4` → `1,25`. Point décimal en virgule, comme partout ailleurs dans l'interface. */
const formatRate = (rate: number): string => `${rate}×`.replace('.', ',');

/**
 * Stepper de vitesse : deux boutons qui déplacent la vitesse d'un cran, et
 * la valeur centrale qui revient directement au tempo d'origine au tap. Un
 * seul widget pour la barre de transport (`transport.ts`) et l'écran de
 * filage (`filage.ts`), qui partagent le même réglage de vitesse.
 *
 * Quand le tempo d'origine est connu (`getBpm`, #111), l'affichage et les
 * pas se font en BPM (`115 BPM` → `110 BPM`) : un musicien raisonne en BPM,
 * pas en pourcentage de la vitesse d'origine. Sans détection disponible
 * (source sans BPM mesuré), on retombe sur la vitesse relative (`0,95×`).
 * `getBpm` est relu à chaque appui : la source active peut changer (bascule
 * Original/Playback, morceau suivant en filage) sans recréer le widget —
 * `refresh()` le fait repeindre après un tel changement.
 */
export function renderRateStepper(
  player: { setRate(rate: number): number; getRate(): number },
  options: { getBpm?: () => number | null } = {},
): {
  minus: HTMLButtonElement;
  value: HTMLButtonElement;
  plus: HTMLButtonElement;
  /** Pastille « Vitesse » du dock mobile, qui ouvre le stepper en panneau. */
  compact: HTMLElement;
  refresh: () => void;
} {
  const getBpm = options.getBpm ?? (() => null);
  let rate = player.getRate();

  const minus = el('button', { type: 'button', class: ui.icon }, '−');
  const plus = el('button', { type: 'button', class: ui.icon }, '+');
  const value = el('button', { type: 'button', class: ui.chip }, '');

  // --- Variante mobile ----------------------------------------------------
  //
  // Le stepper à trois boutons ne tient pas dans la rangée des réglages du
  // dock mobile à côté de la bande et de la boucle (#153). Il s'y replie en
  // une pastille « Vitesse » qui l'ouvre en panneau, avec des paliers en
  // plus : on ralentit souvent d'un coup pour déchiffrer, pas cran par cran.
  // Les deux jeux de boutons partagent l'état et se repeignent ensemble.
  const PRESETS = [0.5, 0.7, 0.85, 1].filter((p) => p >= RATE_MIN && p <= RATE_MAX);
  const popMinus = el('button', { type: 'button', class: ui.icon }, '−');
  const popPlus = el('button', { type: 'button', class: ui.icon }, '+');
  const popValue = el('output', {
    class: 'min-w-20 text-center text-lg font-bold tabular-nums text-zinc-100',
  });
  const presetButtons = PRESETS.map((preset) => {
    const button = el('button', { type: 'button' });
    button.addEventListener('click', () => setRate(preset));
    return button;
  });
  const popTitle = el('p', { class: 'text-sm font-semibold text-zinc-100' });
  const popover = el(
    'div',
    {
      class:
        'absolute bottom-full right-0 z-10 mb-3 hidden w-64 flex-col gap-3 rounded-xl ' +
        'border border-zinc-700 bg-zinc-900 p-3 shadow-2xl shadow-black/60',
      role: 'dialog',
      'aria-label': 'Vitesse de lecture',
    },
    popTitle,
    el('div', { class: 'flex items-center justify-between' }, popMinus, popValue, popPlus),
    el('div', { class: 'flex gap-1.5' }, ...presetButtons),
  );
  // « Tempo 110 » plutôt que « Vitesse 110 BPM » : la rangée mobile n'a pas
  // la place pour l'unité, et la légende la dit déjà.
  const compactCaption = el('span', {
    class: 'text-[9px] font-bold uppercase leading-none tracking-wider text-zinc-500',
  });
  const compactValue = el('span', { class: 'text-[13px] font-semibold leading-none' });
  const compactButton = el(
    'button',
    { type: 'button' },
    captionedValue(compactCaption, compactValue),
  );
  const compact = el('div', { class: 'relative md:hidden' }, compactButton, popover);
  createPopover({ trigger: compactButton, panel: popover, container: compact });

  function paint(): void {
    minus.disabled = popMinus.disabled = rate <= RATE_MIN;
    plus.disabled = popPlus.disabled = rate >= RATE_MAX;
    const bpm = getBpm();
    const targetBpm = bpm ? Math.round(rate * bpm) : null;
    // Le cran « vitesse d'origine » est l'état neutre : c'est tout écart qui
    // s'annonce comme actif.
    paintToggle(value, rate !== RATE_MAX, 'chip');
    paintToggle(compactButton, rate !== RATE_MAX, 'chip', DOCK_CHIP_MOBILE);
    value.textContent = targetBpm !== null ? `${targetBpm} BPM` : formatRate(rate);
    // En pourcentage sur mobile : « 1× » se lisait mal, même légendé.
    compactCaption.textContent = targetBpm !== null ? 'Tempo' : 'Vitesse';
    compactValue.textContent = targetBpm !== null ? String(targetBpm) : `${Math.round(rate * 100)} %`;
    popTitle.textContent = targetBpm !== null ? 'Tempo de lecture (BPM)' : 'Vitesse de lecture';
    popValue.textContent = targetBpm !== null ? `${targetBpm} BPM` : `${Math.round(rate * 100)} %`;
    PRESETS.forEach((preset, i) => {
      const button = presetButtons[i]!;
      button.textContent = bpm ? String(Math.round(preset * bpm)) : `${Math.round(preset * 100)} %`;
      paintToggle(button, Math.abs(rate - preset) < 0.001, 'chip', 'flex-1');
    });
    const label = targetBpm !== null ? `Tempo ${targetBpm} BPM` : `Vitesse ${formatRate(rate)}`;
    const resetHint = targetBpm !== null ? 'revenir au tempo original' : 'revenir à vitesse normale';
    minus.setAttribute('aria-label', `Ralentir — ${label}`);
    plus.setAttribute('aria-label', `Accélérer — ${label}`);
    popMinus.setAttribute('aria-label', `Ralentir — ${label}`);
    popPlus.setAttribute('aria-label', `Accélérer — ${label}`);
    compactButton.setAttribute('aria-label', `${label} — toucher pour régler`);
    value.setAttribute(
      'aria-label',
      rate === RATE_MAX ? label : `${label}, toucher pour ${resetHint}`,
    );
  }

  function setRate(next: number): void {
    rate = player.setRate(next);
    paint();
  }
  const step = (direction: 1 | -1): void => {
    const bpm = getBpm();
    setRate(bpm ? stepBpm(rate, bpm, direction) : stepRate(rate, direction));
  };

  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  popMinus.addEventListener('click', () => step(-1));
  popPlus.addEventListener('click', () => step(1));
  value.addEventListener('click', () => {
    if (rate === RATE_MAX) return;
    setRate(RATE_MAX);
  });

  paint();
  return { minus, value, plus, compact, refresh: paint };
}
