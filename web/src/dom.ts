/** Petites fabriques DOM, pour écrire les vues sans framework. */

import { RATE_MAX, RATE_MIN, stepRate } from './audio';

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
    'border-amber-400/60 bg-amber-400/15 px-4 text-sm font-medium ' +
    'text-amber-200 transition focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400',
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
    'border border-amber-400/60 bg-amber-400/15 px-3 text-xs font-semibold ' +
    'text-amber-200 transition focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400',
  /** Contrôle carré et compact (icône seule) de la barre de transport. */
  icon:
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' +
    'border border-zinc-700 bg-zinc-800/80 text-base text-zinc-300 ' +
    'transition hover:border-zinc-500 hover:bg-zinc-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40',
  iconActive:
    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' +
    'border border-amber-400/60 bg-amber-400/15 text-base text-amber-200 ' +
    'transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
  card: 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4',
  label: 'text-xs font-semibold uppercase tracking-wider text-zinc-500',
};

const segClass = (on: boolean): string =>
  'min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium transition ' +
  (on
    ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
    : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-700');

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
    button.addEventListener('click', () => {
      current = option.value;
      buttons.forEach((other, i) => {
        other.className = segClass(options[i]!.value === current);
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
 * Stepper de vitesse `−  0,95×  +` : deux boutons qui déplacent la vitesse
 * d'un cran (`stepRate`), et la valeur centrale qui revient directement à
 * vitesse normale au tap. Un seul widget pour la barre de transport
 * (`transport.ts`) et l'écran de filage (`filage.ts`), qui partagent le même
 * réglage de vitesse.
 */
export function renderRateStepper(player: {
  setRate(rate: number): number;
  getRate(): number;
}): { minus: HTMLButtonElement; value: HTMLButtonElement; plus: HTMLButtonElement } {
  let rate = player.getRate();

  const minus = el('button', { type: 'button', class: ui.icon }, '−');
  const plus = el('button', { type: 'button', class: ui.icon }, '+');
  const value = el('button', { type: 'button', class: ui.chip }, '');

  function paint(): void {
    minus.disabled = rate <= RATE_MIN;
    plus.disabled = rate >= RATE_MAX;
    value.className = rate === RATE_MAX ? ui.chip : ui.chipActive;
    value.textContent = formatRate(rate);
    const label = `Vitesse ${formatRate(rate)}`;
    minus.setAttribute('aria-label', `Ralentir — ${label}`);
    plus.setAttribute('aria-label', `Accélérer — ${label}`);
    value.setAttribute(
      'aria-label',
      rate === RATE_MAX ? label : `${label}, toucher pour revenir à vitesse normale`,
    );
  }

  minus.addEventListener('click', () => {
    rate = player.setRate(stepRate(rate, -1));
    paint();
  });
  plus.addEventListener('click', () => {
    rate = player.setRate(stepRate(rate, 1));
    paint();
  });
  value.addEventListener('click', () => {
    if (rate === RATE_MAX) return;
    rate = player.setRate(RATE_MAX);
    paint();
  });

  paint();
  return { minus, value, plus };
}
