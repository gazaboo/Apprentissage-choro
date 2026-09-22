/** Petites fabriques DOM, pour écrire les vues sans framework. */

import { formatTime, RATE_MAX, RATE_MIN, stepBpm, stepRate } from './audio';
import { INSTRUMENT_CHIP_LABELS, type AudioKind, type InstrumentId } from './types';

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
 * - **Sélection** (`*Active`) : gris relevé, jamais ambre. Trois canaux à la
 *   fois — bordure plus claire, surface remontée d'un cran, texte plus gras —
 *   pour rester identifiable sans dépendre de la couleur seule.
 *
 * L'anneau de focus reste ambre : il dit « le clavier est ici », ce qui est
 * une quatrième question, orthogonale aux trois autres.
 */
export const ui = {
  button:
    'inline-flex min-h-11 items-center justify-center rounded-lg border ' +
    'border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-200 ' +
    'transition hover:border-zinc-500 hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800',
  buttonActive:
    'inline-flex min-h-11 items-center justify-center rounded-lg border ' +
    'border-zinc-300/70 bg-zinc-700 px-4 text-sm font-semibold ' +
    'text-white transition hover:bg-zinc-600 focus:outline-none ' +
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
    'border border-zinc-300/70 bg-zinc-700 px-3 text-xs font-semibold ' +
    'text-white transition hover:bg-zinc-600 focus:outline-none ' +
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
    'border border-zinc-300/70 bg-zinc-700 text-base font-semibold text-white ' +
    'transition hover:bg-zinc-600 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400',
  card: 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4',
  label: 'text-xs font-semibold uppercase tracking-wider text-zinc-500',
};

/** Les trois gabarits de contrôle à bascule de `ui`. */
export type ToggleVariant = 'button' | 'chip' | 'icon';

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
  const track = el(
    'div',
    { class: 'seek-track relative w-full rounded-full bg-zinc-700' },
    ...(options.decorations ?? []),
    fill,
  );
  const root = el(
    'div',
    {
      // La zone de saisie fait 44 px de haut, même si la piste n'en fait que 4.
      class: 'seek-bar flex h-11 w-full min-w-0 flex-1 cursor-pointer items-center',
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
  const HINTS: Record<AudioKind, string> = {
    reference: 'Enregistrement original, thème compris',
    playback: 'Accompagnement seul, sans le thème',
  };
  const cycles = options.available.length > 1;
  let current = options.current;

  const root = el('button', {
    type: 'button',
    class: `${ui.chip} gap-1.5${options.extra ? ` ${options.extra}` : ''}`,
  });

  function paint(): void {
    root.replaceChildren(
      el('span', { class: 'font-semibold' }, LABELS[current]),
      ...(cycles
        ? [el('span', { class: 'text-sm leading-none opacity-60', 'aria-hidden': 'true' }, '⇄')]
        : []),
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
 */
export function createSegmented<T extends string>(
  options: { value: T; label: string }[],
  onPick: (value: T) => void,
  { variant = 'button', extra = '' }: { variant?: ToggleVariant; extra?: string } = {},
): Segmented<T> {
  const buttons = options.map((option) => {
    const button = el('button', { type: 'button' }, option.label);
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

/**
 * Pastille de transposition : « Ut ▾ », un appui pour passer à la suivante.
 *
 * Quand le morceau n'a qu'une tonalité, elle reste affichée mais inerte —
 * l'information « cette partition est en Ut » vaut d'être lue même lorsqu'il
 * n'y a rien à choisir, et c'est elle qui remplace la mention « Concert
 * (Ut / C) » retirée du sous-titre (#137).
 */
export function createInstrumentChip(options: {
  instruments: { id: InstrumentId; name: string }[];
  current: InstrumentId;
  onPick: (id: InstrumentId) => void;
  extra?: string;
}): { root: HTMLButtonElement; set(id: InstrumentId): void } {
  const ids = options.instruments.map((instrument) => instrument.id);
  const nameOf = (id: InstrumentId): string =>
    options.instruments.find((instrument) => instrument.id === id)?.name ?? id;
  const cycles = ids.length > 1;

  const root = el('button', {
    type: 'button',
    class: `${ui.chip} gap-1.5${options.extra ? ` ${options.extra}` : ''}`,
    disabled: !cycles,
  });
  let current = options.current;

  function paint(): void {
    const label = el('span', { class: 'font-semibold' }, INSTRUMENT_CHIP_LABELS[current] ?? current);
    // Le chevron dit « ça se change » : sans tonalité alternative, il mentirait.
    root.replaceChildren(
      ...(cycles
        ? [label, el('span', { class: 'text-sm leading-none opacity-60', 'aria-hidden': 'true' }, '▾')]
        : [label]),
    );
    root.title = nameOf(current);
    root.setAttribute(
      'aria-label',
      cycles
        ? `Transposition ${nameOf(current)} — toucher pour changer`
        : `Transposition ${nameOf(current)}`,
    );
  }

  root.addEventListener('click', () => {
    if (!cycles) return;
    current = ids[(ids.indexOf(current) + 1) % ids.length]!;
    paint();
    options.onPick(current);
  });

  paint();
  return {
    root,
    set(id) {
      current = id;
      paint();
    },
  };
}

const segClass = (on: boolean): string =>
  'min-h-11 flex-1 rounded-lg border px-3 text-sm transition ' +
  (on
    ? 'border-zinc-300/70 bg-zinc-700 font-semibold text-white hover:bg-zinc-600'
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
  refresh: () => void;
} {
  const getBpm = options.getBpm ?? (() => null);
  let rate = player.getRate();

  const minus = el('button', { type: 'button', class: ui.icon }, '−');
  const plus = el('button', { type: 'button', class: ui.icon }, '+');
  const value = el('button', { type: 'button', class: ui.chip }, '');

  function paint(): void {
    minus.disabled = rate <= RATE_MIN;
    plus.disabled = rate >= RATE_MAX;
    const bpm = getBpm();
    const targetBpm = bpm ? Math.round(rate * bpm) : null;
    // Le cran « vitesse d'origine » est l'état neutre : c'est tout écart qui
    // s'annonce comme actif.
    paintToggle(value, rate !== RATE_MAX, 'chip');
    value.textContent = targetBpm !== null ? `${targetBpm} BPM` : formatRate(rate);
    const label = targetBpm !== null ? `Tempo ${targetBpm} BPM` : `Vitesse ${formatRate(rate)}`;
    const resetHint = targetBpm !== null ? 'revenir au tempo original' : 'revenir à vitesse normale';
    minus.setAttribute('aria-label', `Ralentir — ${label}`);
    plus.setAttribute('aria-label', `Accélérer — ${label}`);
    value.setAttribute(
      'aria-label',
      rate === RATE_MAX ? label : `${label}, toucher pour ${resetHint}`,
    );
  }

  minus.addEventListener('click', () => {
    const bpm = getBpm();
    rate = player.setRate(bpm ? stepBpm(rate, bpm, -1) : stepRate(rate, -1));
    paint();
  });
  plus.addEventListener('click', () => {
    const bpm = getBpm();
    rate = player.setRate(bpm ? stepBpm(rate, bpm, 1) : stepRate(rate, 1));
    paint();
  });
  value.addEventListener('click', () => {
    if (rate === RATE_MAX) return;
    rate = player.setRate(RATE_MAX);
    paint();
  });

  paint();
  return { minus, value, plus, refresh: paint };
}
