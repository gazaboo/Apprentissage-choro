/** Petites fabriques DOM, pour écrire les vues sans framework. */

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
