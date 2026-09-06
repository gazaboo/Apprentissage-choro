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

/** Classes partagées, pour garder les vues cohérentes sans les répéter. */
export const ui = {
  button:
    'rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium ' +
    'text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-800',
  buttonActive:
    'rounded-md border border-amber-400/60 bg-amber-400/15 px-3 py-2 text-sm ' +
    'font-medium text-amber-200 transition focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-amber-400',
  primary:
    'rounded-md bg-amber-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 ' +
    'transition hover:bg-amber-300 focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-amber-400 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40',
  card: 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4',
  label: 'text-xs font-semibold uppercase tracking-wider text-zinc-500',
  kbd: 'rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300',
};
